import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { ROOT_DIR, store } from './config.js';
import { events } from './events.js';
import { displayTitle, folderSettings, getTracks } from './library.js';
import { logLines, stopProcess } from './proc.js';
import type { Playback, PlayerState, Station } from './shared.js';
import { hhmm, inTimeRange } from './time.js';

const SOCKET = path.join(os.tmpdir(), 'sleepy-mpv.sock');
const PLAYLIST = path.join(os.tmpdir(), 'sleepy-playlist.m3u');
const DUCK_RATIO = 0.3;
const VOLUME_CAP_CHECK_MS = 20_000;
// Resumed stories start a little before where they stopped, so the listener catches the thread again.
const RESUME_REWIND_S = 5;

const state: PlayerState = {
	available: false,
	status: 'stopped',
	source: null,
	track: null,
	volume: store.state.volume ?? store.config.volume.default,
	maxVolume: store.config.volume.max,
};

let proc: ChildProcess | null = null;
let socket: net.Socket | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();
let paused = false;
let idle = true;
let ducked = false;
let restartDelay = 1000;
// The playlist in play order, kept so a resume can rebuild the same (possibly shuffled) order.
let currentPlaylist: string[] = [];
// Set while restoring a session: once the saved entry loads, seek to the saved spot and apply the saved pause state.
let pendingStart: { index: number; position: number; paused: boolean } | null = null;
// The schedule that started the current playback; anything started by hand clears it.
let scheduleId: string | null = null;
let shuttingDown = false;

function emit() {
	events.emit('player', getPlayerState());
}

export function getPlayerState(): PlayerState {
	return { ...state };
}

function updateStatus() {
	if (idle) {
		state.status = 'stopped';
		state.source = null;
		state.track = null;
	} else if (paused) {
		state.status = 'paused';
	} else {
		state.status = 'playing';
	}
	emit();
}

function command(...args: unknown[]): Promise<unknown> {
	const sock = socket;
	if (!sock) {
		return Promise.reject(new Error('Player is not running'));
	}
	const id = nextRequestId++;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`mpv did not answer ${String(args[0])}`));
		}, 5000);
		pending.set(id, {
			resolve: (data) => {
				clearTimeout(timer);
				resolve(data);
			},
			reject: (err) => {
				clearTimeout(timer);
				reject(err);
			},
		});
		sock.write(`${JSON.stringify({ command: args, request_id: id })}\n`);
	});
}

interface MpvMessage {
	request_id?: number;
	error?: string;
	data?: unknown;
	event?: string;
	name?: string;
}

function handleMessage(msg: MpvMessage) {
	if (msg.request_id !== undefined) {
		const request = pending.get(msg.request_id);
		pending.delete(msg.request_id);
		if (msg.error === 'success') {
			request?.resolve(msg.data);
		} else {
			request?.reject(new Error(`mpv: ${msg.error}`));
		}
		return;
	}
	if (msg.event === 'file-loaded') {
		applyPendingStart().catch((err: Error) => console.error('[player] resume seek failed:', err.message));
		return;
	}
	if (msg.event !== 'property-change') {
		return;
	}
	if (msg.name === 'pause') {
		paused = msg.data === true;
		updateStatus();
	} else if (msg.name === 'idle-active') {
		idle = msg.data === true;
		updateStatus();
	} else if (msg.name === 'media-title') {
		state.track = typeof msg.data === 'string' ? displayTitle(msg.data) : null;
		emit();
	}
}

async function connect(): Promise<net.Socket> {
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			return await new Promise((resolve, reject) => {
				const sock = net.createConnection(SOCKET, () => resolve(sock));
				sock.once('error', reject);
			});
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	throw new Error('Could not connect to mpv IPC socket');
}

function deviceArgs() {
	const device = store.config.audio.mpvDevice;
	if (device && device !== 'auto') {
		return [`--audio-device=${device}`];
	}
	// Go straight to ALSA's default (dmix from setup-pi.sh) instead of probing JACK/PulseAudio first.
	return process.platform === 'linux' ? ['--ao=alsa'] : [];
}

async function startMpv() {
	await rm(SOCKET, { force: true });
	const child = spawn('mpv', [
		'--idle=yes',
		'--no-video',
		'--no-terminal',
		`--input-ipc-server=${SOCKET}`,
		`--volume=${ducked ? Math.round(state.volume * DUCK_RATIO) : state.volume}`,
		'--volume-max=100',
		// mpv's default network cache is sized for video and would eat a big slice of the Pi's RAM.
		'--demuxer-max-bytes=4MiB',
		'--demuxer-max-back-bytes=1MiB',
		...deviceArgs(),
	], { stdio: ['ignore', 'ignore', 'pipe'] });
	proc = child;

	// A failed spawn emits 'error' but not always 'exit', so both paths funnel into one idempotent cleanup.
	let gone = false;
	const onGone = () => {
		if (gone) {
			return;
		}
		gone = true;
		proc = null;
		socket?.destroy();
		socket = null;
		for (const request of pending.values()) {
			request.reject(new Error('mpv exited'));
		}
		pending.clear();
		state.available = false;
		idle = true;
		updateStatus();
		if (!shuttingDown) {
			setTimeout(() => void startMpv(), restartDelay);
			restartDelay = Math.min(restartDelay * 2, 30_000);
		}
	};

	logLines(child.stderr, 'mpv');
	child.on('exit', onGone);
	child.on('error', (err: NodeJS.ErrnoException) => {
		if (err.code === 'ENOENT') {
			console.error('[player] mpv is not installed (brew install mpv / apt install mpv)');
		} else {
			console.error('[player] mpv failed to start', err);
		}
		onGone();
	});
	if (!child.pid) {
		return;
	}

	try {
		const sock = await connect();
		socket = sock;
		createInterface({ input: sock }).on('line', (line) => handleMessage(JSON.parse(line) as MpvMessage));
		sock.on('error', () => sock.destroy());
		await command('observe_property', 1, 'pause');
		await command('observe_property', 2, 'idle-active');
		await command('observe_property', 3, 'media-title');
		state.available = true;
		restartDelay = 1000;
		emit();
	} catch (err) {
		console.error('[player]', (err as Error).message);
		stopProcess(child);
	}
}

function shuffled<T>(items: T[]) {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

// `startTrack` plays that track first and then carries on through the folder.
export async function playFolder(name: string, startTrack = 0, fromSchedule?: string) {
	const tracks = getTracks(name);
	if (!tracks.length) {
		throw new Error(`No tracks found in "${name}"`);
	}
	const settings = folderSettings(name);
	let list = tracks;
	let startIndex = startTrack;
	if (settings.shuffle) {
		const first = tracks[startTrack] ?? tracks[0];
		list = [first, ...shuffled(tracks.filter((track) => track !== first))];
		startIndex = 0;
	}
	currentPlaylist = list;
	pendingStart = null;
	await writeFile(PLAYLIST, `${list.join('\n')}\n`);
	await command('set_property', 'loop-playlist', settings.loop ? 'inf' : 'no');
	// Paused while loading so the first track does not blip before jumping to the requested one.
	await command('set_property', 'pause', true);
	await command('loadlist', PLAYLIST, 'replace');
	if (startIndex > 0) {
		await command('playlist-play-index', startIndex);
	}
	await command('set_property', 'pause', false);
	state.source = { type: 'folder', name, label: name };
	scheduleId = fromSchedule ?? null;
	emit();
}

async function applyPendingStart() {
	const start = pendingStart;
	if (!start) {
		return;
	}
	// loadlist briefly loads the first entry before jumping, so wait until the saved entry is the one that loaded.
	if (Number(await command('get_property', 'playlist-pos')) !== start.index) {
		return;
	}
	pendingStart = null;
	if (start.position > 0) {
		await command('seek', start.position, 'absolute');
	}
	await command('set_property', 'pause', start.paused);
}

// A snapshot of what is playing right now, or null when nothing is.
export async function snapshot(): Promise<Playback | null> {
	const source = state.source;
	if (!state.available || state.status === 'stopped' || !source) {
		return null;
	}
	const base = { source, paused: state.status === 'paused', savedAt: Date.now(), ...(scheduleId ? { scheduleId } : {}) };
	if (source.type === 'radio') {
		return base;
	}
	const [index, position] = await Promise.all([command('get_property', 'playlist-pos'), command('get_property', 'time-pos')]);
	return { ...base, playlist: currentPlaylist, index: Number(index), position: Math.round(Number(position) || 0) };
}

// Rebuilds a saved folder session: same play order, same track, a few seconds before where it stopped.
export async function restoreFolder(playback: Playback) {
	if (playback.source.type !== 'folder' || !playback.playlist) {
		return;
	}
	const current = playback.playlist[playback.index ?? 0];
	// Files may have been removed while the Pi was off; the rest of the saved order still applies.
	const playlist = playback.playlist.filter((file) => existsSync(file));
	const index = playlist.indexOf(current);
	if (index === -1) {
		return playFolder(playback.source.name, 0, playback.scheduleId);
	}
	currentPlaylist = playlist;
	pendingStart = { index, position: Math.max(0, (playback.position ?? 0) - RESUME_REWIND_S), paused: playback.paused };
	await writeFile(PLAYLIST, `${playlist.join('\n')}\n`);
	await command('set_property', 'loop-playlist', folderSettings(playback.source.name).loop ? 'inf' : 'no');
	await command('set_property', 'pause', true);
	await command('loadlist', PLAYLIST, 'replace');
	if (index > 0) {
		await command('playlist-play-index', index);
	}
	state.source = playback.source;
	scheduleId = playback.scheduleId ?? null;
	emit();
}

export async function playStation(station: Station, fromSchedule?: string) {
	pendingStart = null;
	await command('set_property', 'loop-playlist', 'no');
	await command('loadfile', station.url, 'replace');
	await command('set_property', 'pause', false);
	state.source = { type: 'radio', id: station.id, label: station.name };
	scheduleId = fromSchedule ?? null;
	emit();
}

export async function stop() {
	await command('stop');
}

export async function pause() {
	await command('set_property', 'pause', true);
}

export async function resume() {
	await command('set_property', 'pause', false);
}

export async function next() {
	await command('playlist-next', 'weak');
}

// Back to the start of the current track, and playing even if it was paused.
export async function restart() {
	await command('seek', 0, 'absolute');
	await command('set_property', 'pause', false);
}

// `feedback` plays a tick at the new level so a parent or child hears the change, but not when settings merely re-clamp it.
export async function setVolume(volume: number, feedback = false) {
	state.maxVolume = maxAllowed();
	state.volume = Math.max(0, Math.min(state.maxVolume, Math.round(volume)));
	store.state.volume = state.volume;
	await store.saveState();
	emit();
	// Played before talking to mpv so the tick still confirms the speaker works when the main player is down.
	if (feedback) {
		chime('volume');
	}
	if (!ducked && socket) {
		await command('set_property', 'volume', state.volume);
	}
}

export function changeVolume(direction: 1 | -1) {
	return setVolume(state.volume + direction * store.config.volume.step, true);
}

export function maxVolume() {
	return setVolume(maxAllowed(), true);
}

// The night cap from Settings wins over the normal max while its time window is active.
export function maxAllowed(now = new Date()) {
	const { max, quietHours } = store.config.volume;
	if (quietHours && inTimeRange(hhmm(now), quietHours)) {
		return Math.min(max, quietHours.max);
	}
	return max;
}

// Lowers the volume silently (no tick) when the night window starts; it is not raised again when the window ends.
async function enforceVolumeCap() {
	const max = maxAllowed();
	if (state.volume > max) {
		await setVolume(max);
	} else if (state.maxVolume !== max) {
		state.maxVolume = max;
		emit();
	}
}

// Lowered while the voice command window is open so the mic can hear the child over the music.
export async function duck(on: boolean) {
	if (ducked === on) {
		return;
	}
	ducked = on;
	if (socket) {
		await command('set_property', 'volume', on ? Math.round(state.volume * DUCK_RATIO) : state.volume);
	}
}

// MBROLA's us3 voice sounds far less robotic than stock espeak, but it is built by setup-pi.sh and absent on dev machines.
const MBROLA_VOICE = '/usr/share/mbrola/us3/us3';
const speechArgs = existsSync(MBROLA_VOICE) ? ['-v', 'mb-us3', '-s', '140'] : ['-v', 'en-us', '-s', '145'];

// espeak-ng renders a WAV to stdout and a short-lived mpv plays it, so speech mixes over music like the chimes do.
export function speak(text: string) {
	return new Promise<void>((resolve) => {
		void duck(true).catch(() => {});
		const tts = spawn('espeak-ng', [...speechArgs, '--stdout', text], { stdio: ['ignore', 'pipe', 'ignore'] });
		const out = spawn('mpv', [
			'--no-video',
			'--no-terminal',
			`--volume=${Math.max(state.volume, 30)}`,
			...deviceArgs(),
			'-',
		], { stdio: ['pipe', 'ignore', 'ignore'] });
		tts.stdout.pipe(out.stdin);
		out.stdin.on('error', () => {});
		tts.on('error', (err: NodeJS.ErrnoException) => {
			console.error(err.code === 'ENOENT' ? '[player] espeak-ng is not installed (brew/apt install espeak-ng)' : `[player] espeak-ng failed: ${err.message}`);
			stopProcess(out);
		});
		let finished = false;
		const done = () => {
			if (finished) {
				return;
			}
			finished = true;
			void duck(false).catch(() => {});
			resolve();
		};
		out.on('close', done);
		out.on('error', done);
	});
}

export function chime(name: 'wake' | 'error' | 'volume') {
	// The volume tick plays at the new level on purpose; alerts get a floor so they are never inaudible.
	const volume = name === 'volume' ? state.volume : Math.max(state.volume, 30);
	const child = spawn('mpv', [
		'--no-video',
		'--no-terminal',
		`--volume=${volume}`,
		...deviceArgs(),
		path.join(ROOT_DIR, 'assets', `chime-${name}.wav`),
	], { stdio: 'ignore' });
	child.on('error', () => {});
}

export function startPlayer() {
	void startMpv();
	const enforce = () => void enforceVolumeCap().catch((err: Error) => console.error('[player]', err.message));
	enforce();
	setInterval(enforce, VOLUME_CAP_CHECK_MS);
}

export function stopPlayer() {
	shuttingDown = true;
	stopProcess(proc);
}
