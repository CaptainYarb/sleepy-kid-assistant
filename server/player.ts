import { spawn, type ChildProcess } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { ROOT_DIR, store } from './config.js';
import { events } from './events.js';
import { folderSettings, getTracks } from './library.js';
import type { PlayerState, Station } from './shared.js';

const SOCKET = path.join(os.tmpdir(), 'sleepy-mpv.sock');
const PLAYLIST = path.join(os.tmpdir(), 'sleepy-playlist.m3u');
const DUCK_RATIO = 0.3;

const state: PlayerState = {
	available: false,
	status: 'stopped',
	source: null,
	track: null,
	volume: store.state.volume ?? store.config.volume.default,
};

let proc: ChildProcess | null = null;
let socket: net.Socket | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (data: unknown) => void; reject: (err: Error) => void }>();
let paused = false;
let idle = true;
let ducked = false;
let restartDelay = 1000;
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
		state.track = typeof msg.data === 'string' ? msg.data : null;
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
	return device && device !== 'auto' ? [`--audio-device=${device}`] : [];
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

	child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[mpv] ${chunk}`));
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
		child.kill();
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

export async function playFolder(name: string) {
	const tracks = getTracks(name);
	if (!tracks.length) {
		throw new Error(`No tracks found in "${name}"`);
	}
	const settings = folderSettings(name);
	const list = settings.shuffle ? shuffled(tracks) : tracks;
	await writeFile(PLAYLIST, `${list.join('\n')}\n`);
	await command('set_property', 'loop-playlist', settings.loop ? 'inf' : 'no');
	await command('loadlist', PLAYLIST, 'replace');
	await command('set_property', 'pause', false);
	state.source = { type: 'folder', name, label: name };
	emit();
}

export async function playStation(station: Station) {
	await command('set_property', 'loop-playlist', 'no');
	await command('loadfile', station.url, 'replace');
	await command('set_property', 'pause', false);
	state.source = { type: 'radio', id: station.id, label: station.name };
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

export async function setVolume(volume: number) {
	state.volume = Math.max(0, Math.min(store.config.volume.max, Math.round(volume)));
	store.state.volume = state.volume;
	await store.saveState();
	emit();
	if (!ducked && socket) {
		await command('set_property', 'volume', state.volume);
	}
}

export function changeVolume(direction: 1 | -1) {
	return setVolume(state.volume + direction * store.config.volume.step);
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

export function chime(name: 'wake' | 'error') {
	const child = spawn('mpv', [
		'--no-video',
		'--no-terminal',
		`--volume=${Math.max(state.volume, 30)}`,
		...deviceArgs(),
		path.join(ROOT_DIR, 'assets', `chime-${name}.wav`),
	], { stdio: 'ignore' });
	child.on('error', () => {});
}

export function startPlayer() {
	void startMpv();
}

export function stopPlayer() {
	shuttingDown = true;
	proc?.kill();
}
