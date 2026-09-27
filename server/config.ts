import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { open, rename } from 'node:fs/promises';
import path from 'node:path';
import { COMMAND_TYPES } from './commands.js';
import type { Config, Playback, Schedule } from './shared.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
export const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR ?? 'media');
// Compiled output lives in dist/server, source in server/, and assets are resolved from the repo root either way.
const isBuilt = path.basename(path.dirname(import.meta.dirname)) === 'dist';
export const ROOT_DIR = path.resolve(import.meta.dirname, isBuilt ? '../..' : '..');

export interface State {
	volume: number | null;
	lastFired: Record<string, string>;
	playback?: Playback | null;
}

const defaultConfig: Config = {
	pin: '',
	wakePhrase: 'hey sleepy',
	volume: { default: 40, max: 80, step: 10, quietHours: null },
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
	weather: { place: '', latitude: null, longitude: null, units: 'fahrenheit' },
	// Unrestricted by default; parents can limit voice to an allowlist of command types in Settings.
	voice: { restricted: false, allowed: [...COMMAND_TYPES], hours: null },
	// Long outages do not resume, so bedtime sounds never restart in the morning.
	resume: { enabled: true, withinMinutes: 30 },
};

function readJson<T>(file: string, fallback: T): T {
	const full = path.join(DATA_DIR, file);
	if (!existsSync(full)) {
		return fallback;
	}
	try {
		return JSON.parse(readFileSync(full, 'utf8')) as T;
	} catch (err) {
		// A crash here would restart-loop the service forever, so set the bad file aside for repair and carry on.
		const aside = `${full}.corrupt-${Date.now()}`;
		renameSync(full, aside);
		console.error(`[config] ${file} was unreadable (${(err as Error).message}); moved to ${aside} and using defaults`);
		return fallback;
	}
}

let tmpCounter = 0;

// Write to a temp file, flush it to the SD card, then rename, so a power cut mid-write never leaves a truncated JSON file.
async function writeJson(file: string, data: unknown) {
	const full = path.join(DATA_DIR, file);
	const tmp = `${full}.${process.pid}.${tmpCounter++}.tmp`;
	const handle = await open(tmp, 'w');
	try {
		await handle.writeFile(`${JSON.stringify(data, null, '\t')}\n`);
		// Without this the rename can reach the disk before the data does, leaving an empty file after a power cut.
		await handle.sync();
	} finally {
		await handle.close();
	}
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
		weather: { ...defaultConfig.weather, ...file.weather },
		voice: { ...defaultConfig.voice, ...file.voice },
		resume: { ...defaultConfig.resume, ...file.resume },
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
