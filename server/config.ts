import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config, Schedule } from './shared.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
export const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR ?? 'media');
// Compiled output lives in dist/server, source in server/, and assets are resolved from the repo root either way.
const isBuilt = path.basename(path.dirname(import.meta.dirname)) === 'dist';
export const ROOT_DIR = path.resolve(import.meta.dirname, isBuilt ? '../..' : '..');

export interface State {
	volume: number | null;
	lastFired: Record<string, string>;
}

const defaultConfig: Config = {
	pin: '',
	wakePhrase: 'hey sleepy',
	volume: { default: 40, max: 80, step: 10 },
	audio: {
		mpvDevice: 'auto',
		recordCommand: process.platform === 'darwin'
			? 'sox -q -d -t raw -r 16000 -c 1 -b 16 -e signed -'
			: 'arecord -q -f S16_LE -r 16000 -c 1 -t raw',
	},
	folders: {},
	radio: { defaultStation: '', stations: [] },
	lcd: { enabled: true, address: '0x27', backlightTimeoutSec: 30, darkHours: null },
	// Off by default so the Bluetooth radio does not draw power until someone opts in.
	bluetooth: { enabled: false },
};

function readJson<T>(file: string, fallback: T): T {
	const full = path.join(DATA_DIR, file);
	if (!existsSync(full)) {
		return fallback;
	}
	return JSON.parse(readFileSync(full, 'utf8')) as T;
}

let tmpCounter = 0;

// Write to a temp file and rename so a power cut mid-write never leaves a truncated JSON file.
async function writeJson(file: string, data: unknown) {
	const full = path.join(DATA_DIR, file);
	const tmp = `${full}.${process.pid}.${tmpCounter++}.tmp`;
	await writeFile(tmp, `${JSON.stringify(data, null, '\t')}\n`);
	await rename(tmp, full);
}

function loadConfig(): Config {
	const file = readJson<Partial<Config>>('config.json', {});
	return {
		...defaultConfig,
		...file,
		volume: { ...defaultConfig.volume, ...file.volume },
		audio: { ...defaultConfig.audio, ...file.audio },
		radio: { ...defaultConfig.radio, ...file.radio },
		lcd: { ...defaultConfig.lcd, ...file.lcd },
		bluetooth: { ...defaultConfig.bluetooth, ...file.bluetooth },
	};
}

mkdirSync(DATA_DIR, { recursive: true });

export const store = {
	config: loadConfig(),
	schedules: readJson<Schedule[]>('schedules.json', []),
	state: readJson<State>('state.json', { volume: null, lastFired: {} }),

	saveConfig() {
		return writeJson('config.json', this.config);
	},
	saveSchedules() {
		return writeJson('schedules.json', this.schedules);
	},
	saveState() {
		return writeJson('state.json', this.state);
	},
};

if (!store.config.pin) {
	store.config.pin = String(randomInt(100000, 1000000));
	await store.saveConfig();
	console.log(`[config] generated portal PIN ${store.config.pin} (change it in Settings or ${path.join(DATA_DIR, 'config.json')})`);
}
