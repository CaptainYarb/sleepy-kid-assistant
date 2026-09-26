import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, store } from './config.js';
import { events } from './events.js';
import { getPlayerState } from './player.js';
import { hhmm, nextRun } from './scheduler.js';
import type { LcdState, TimeRange } from './shared.js';
import { getVoiceStatus } from './voice.js';

const COLS = 16;
const FRAME_MS = 400;
const FLASH_MS = 3000;
const SCROLL_GAP = '   ';
// The bottom-right corner is reserved for the volume, e.g. " 40%".
const VOLUME_COLS = 4;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VENV_PYTHON = path.join(ROOT_DIR, 'py', '.venv', 'bin', 'python');
const useHardware = process.env.LCD !== 'mock' && process.platform === 'linux';

let state: LcdState = { lines: ['', ''], backlight: false };
let lastActivity = Date.now();
let flash: { text: string; until: number } | null = null;
const scrollFrames: [number, number] = [0, 0];
let rawLines: [string, string] = ['', ''];
let proc: ChildProcess | null = null;
let sentLine = '';
let restartDelay = 2000;
let shuttingDown = false;

export function getLcdState(): LcdState {
	return state;
}

// The HD44780 character ROM only has ASCII, so accents are stripped and anything else becomes '?'.
export function toLcdText(text: string) {
	return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]/g, '?');
}

export function marquee(text: string, frame: number, width = COLS) {
	if (text.length <= width) {
		return text.padEnd(width);
	}
	const loop = text + SCROLL_GAP;
	const offset = frame % loop.length;
	return (loop + loop).slice(offset, offset + width);
}

export function inTimeRange(time: string, range: TimeRange) {
	if (range.start <= range.end) {
		return time >= range.start && time < range.end;
	}
	// Ranges like 20:00-07:00 wrap past midnight.
	return time >= range.start || time < range.end;
}

function spread(left: string, right: string) {
	return left.slice(0, COLS - right.length - 1).padEnd(COLS - right.length) + right;
}

function bottomLine(text: string, frame: number) {
	const volume = `${getPlayerState().volume}%`.padStart(VOLUME_COLS);
	return `${marquee(text, frame, COLS - VOLUME_COLS - 1)} ${volume}`;
}

function compose(now: Date): [string, string] {
	const player = getPlayerState();
	if (getVoiceStatus().listening) {
		return ['Listening...', 'Go ahead'];
	}
	if (flash && flash.until > now.getTime()) {
		return ['Heard:', flash.text];
	}
	if (player.status !== 'stopped' && player.source) {
		const icon = player.status === 'paused' ? '||' : '>';
		return [`${icon} ${player.source.label}`, player.track ?? ''];
	}
	const next = nextRun(store.schedules, now);
	const clock = `${DAYS[now.getDay()]} ${hhmm(now)}`;
	if (!next) {
		return [spread('Zzz', clock), 'No schedule'];
	}
	const at = new Date(next.at);
	const day = at.getDay() === now.getDay() ? '' : `${DAYS[at.getDay()]} `;
	const what = next.schedule.action === 'stop' ? 'stop' : next.schedule.folder ?? 'radio';
	return [spread('Zzz', clock), `Next ${day}${hhmm(at)} ${what}`];
}

function render() {
	const now = new Date();
	const { lcd } = store.config;
	const raw = compose(now).map(toLcdText) as [string, string];
	for (const i of [0, 1] as const) {
		scrollFrames[i] = raw[i] === rawLines[i] ? scrollFrames[i] + 1 : 0;
	}
	rawLines = raw;

	const dark = lcd.darkHours ? inTimeRange(hhmm(now), lcd.darkHours) : false;
	const awake = now.getTime() - lastActivity < lcd.backlightTimeoutSec * 1000;
	const next: LcdState = lcd.enabled
		? { lines: [marquee(raw[0], scrollFrames[0]), bottomLine(raw[1], scrollFrames[1])], backlight: awake && !dark }
		: { lines: [''.padEnd(COLS), ''.padEnd(COLS)], backlight: false };

	if (next.lines[0] !== state.lines[0] || next.lines[1] !== state.lines[1] || next.backlight !== state.backlight) {
		state = next;
		events.emit('lcd', state);
	}
	const line = JSON.stringify({ l1: state.lines[0], l2: state.lines[1], backlight: state.backlight });
	if (proc?.stdin && line !== sentLine) {
		proc.stdin.write(`${line}\n`);
		sentLine = line;
	}
}

function startHardware() {
	const python = existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';
	const child = spawn(python, [path.join(ROOT_DIR, 'py', 'lcd.py'), store.config.lcd.address], { stdio: ['pipe', 'ignore', 'pipe'] });
	proc = child;
	child.stdin.on('error', () => {});
	child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[lcd] ${chunk}`));
	let gone = false;
	const onGone = () => {
		if (gone || shuttingDown) {
			return;
		}
		gone = true;
		proc = null;
		setTimeout(startHardware, restartDelay);
		restartDelay = Math.min(restartDelay * 2, 60_000);
	};
	child.on('exit', onGone);
	child.on('error', onGone);
	sentLine = '';
}

export function startLcd() {
	let playerKey = '';
	events.on('player', (player) => {
		const key = `${player.status}:${player.source?.label ?? ''}:${player.volume}`;
		if (key !== playerKey) {
			playerKey = key;
			lastActivity = Date.now();
		}
	});
	let lastLogAt = 0;
	events.on('voice', (voice) => {
		const latest = voice.log[0];
		if (voice.listening) {
			lastActivity = Date.now();
		}
		if (latest && latest.at !== lastLogAt) {
			lastLogAt = latest.at;
			lastActivity = Date.now();
			if (!latest.result.startsWith('ignored')) {
				flash = { text: latest.result, until: Date.now() + FLASH_MS };
			}
		}
	});
	if (useHardware && store.config.lcd.enabled) {
		startHardware();
	}
	setInterval(render, FRAME_MS);
	render();
}

export function stopLcd() {
	shuttingDown = true;
	proc?.kill();
}
