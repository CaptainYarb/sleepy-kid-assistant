import { randomUUID } from 'node:crypto';
import { COMMAND_TYPES, normalize } from './commands.js';
import type { Config, FolderSettings, PublicConfig, Schedule, Station } from './shared.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function int(value: unknown, name: string, min: number, max: number) {
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max) {
		throw new Error(`${name} must be a whole number from ${min} to ${max}`);
	}
	return n;
}

export function parseSchedule(input: Partial<Schedule>): Schedule {
	if (!TIME.test(input.time ?? '')) {
		throw new Error('Schedule time must look like 19:30');
	}
	const days = [...new Set((input.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
	if (!days.length) {
		throw new Error('Pick at least one day');
	}
	const base = { id: input.id || randomUUID(), enabled: input.enabled !== false, time: input.time!, days };
	if (input.action === 'stop') {
		return { ...base, action: 'stop' };
	}
	if (input.action !== 'play') {
		throw new Error('Schedule action must be play or stop');
	}
	if (input.folder) {
		return { ...base, action: 'play', folder: input.folder };
	}
	if (input.stationId) {
		return { ...base, action: 'play', stationId: input.stationId };
	}
	throw new Error('Pick a folder or radio station to play');
}

export function parseFolderSettings(input: Partial<FolderSettings>, current: FolderSettings): FolderSettings {
	const spokenName = input.spokenName === undefined ? current.spokenName : normalize(input.spokenName);
	if (!spokenName) {
		throw new Error('Spoken name cannot be empty');
	}
	return {
		spokenName,
		shuffle: input.shuffle ?? current.shuffle,
		loop: input.loop ?? current.loop,
		enabled: input.enabled ?? current.enabled,
	};
}

function parseStation(input: Partial<Station>): Station {
	const name = String(input.name ?? '').trim();
	const url = String(input.url ?? '').trim();
	if (!name) {
		throw new Error('Station name cannot be empty');
	}
	if (!/^https?:\/\//.test(url)) {
		throw new Error(`Station "${name}" needs an http(s) stream URL`);
	}
	return { id: input.id || randomUUID(), name, url };
}

// Applies a partial settings update onto the config, throwing before any change if a field is invalid.
export function applyConfigPatch(config: Config, patch: Partial<PublicConfig>): Config {
	const next: Config = structuredClone(config);
	if (patch.wakePhrase !== undefined) {
		const wake = normalize(patch.wakePhrase);
		if (wake.split(' ').length < 2) {
			throw new Error('Use at least two words for the wake phrase so it does not trigger by accident');
		}
		next.wakePhrase = wake;
	}
	if (patch.volume) {
		const volume = { ...config.volume, ...patch.volume };
		const quiet = volume.quietHours;
		if (quiet && (!TIME.test(quiet.start) || !TIME.test(quiet.end))) {
			throw new Error('Night volume hours must look like 20:00');
		}
		next.volume = {
			max: int(volume.max, 'Max volume', 1, 100),
			default: int(volume.default, 'Default volume', 0, 100),
			step: int(volume.step, 'Volume step', 1, 50),
			quietHours: quiet ? { start: quiet.start, end: quiet.end, max: int(quiet.max, 'Night max volume', 0, 100) } : null,
		};
		next.volume.default = Math.min(next.volume.default, next.volume.max);
	}
	if (patch.audio) {
		next.audio = {
			mpvDevice: String(patch.audio.mpvDevice ?? config.audio.mpvDevice).trim() || 'auto',
			recordCommand: String(patch.audio.recordCommand ?? config.audio.recordCommand).trim(),
		};
	}
	if (patch.radio) {
		const stations = (patch.radio.stations ?? config.radio.stations).map(parseStation);
		const wanted = patch.radio.defaultStation ?? config.radio.defaultStation;
		next.radio = {
			stations,
			defaultStation: stations.some((s) => s.id === wanted) ? wanted : stations[0]?.id ?? '',
		};
	}
	if (patch.lcd) {
		const lcd = { ...config.lcd, ...patch.lcd };
		if (!/^0x[0-9a-f]{2}$/i.test(lcd.address)) {
			throw new Error('LCD address must look like 0x27');
		}
		if (lcd.darkHours && (!TIME.test(lcd.darkHours.start) || !TIME.test(lcd.darkHours.end))) {
			throw new Error('Dark hours must look like 20:00');
		}
		next.lcd = {
			enabled: Boolean(lcd.enabled),
			address: lcd.address.toLowerCase(),
			backlightTimeoutSec: int(lcd.backlightTimeoutSec, 'Backlight timeout', 0, 3600),
			darkHours: lcd.darkHours ? { start: lcd.darkHours.start, end: lcd.darkHours.end } : null,
		};
	}
	if (patch.bluetooth) {
		next.bluetooth = { enabled: Boolean(patch.bluetooth.enabled) };
	}
	if (patch.voice) {
		const voice = { ...config.voice, ...patch.voice };
		if (voice.hours && (!TIME.test(voice.hours.start) || !TIME.test(voice.hours.end))) {
			throw new Error('Voice lockdown hours must look like 19:00');
		}
		next.voice = {
			restricted: Boolean(voice.restricted),
			allowed: COMMAND_TYPES.filter((type) => (voice.allowed ?? []).includes(type)),
			hours: voice.hours ? { start: voice.hours.start, end: voice.hours.end } : null,
		};
	}
	if (patch.resume) {
		const resume = { ...config.resume, ...patch.resume };
		next.resume = {
			enabled: Boolean(resume.enabled),
			withinMinutes: int(resume.withinMinutes, 'Resume window', 1, 24 * 60),
		};
	}
	if (patch.weather) {
		const weather = { ...config.weather, ...patch.weather };
		const hasLocation = weather.latitude !== null && weather.longitude !== null;
		const latitude = Number(weather.latitude);
		const longitude = Number(weather.longitude);
		const validLocation = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
		if (hasLocation && !validLocation) {
			throw new Error('Weather location is out of range');
		}
		if (weather.units !== 'fahrenheit' && weather.units !== 'celsius') {
			throw new Error('Weather units must be fahrenheit or celsius');
		}
		next.weather = {
			place: String(weather.place ?? '').trim(),
			latitude: hasLocation ? latitude : null,
			longitude: hasLocation ? longitude : null,
			units: weather.units,
		};
	}
	return next;
}
