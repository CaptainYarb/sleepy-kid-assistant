import { describe, expect, it } from 'vitest';
import type { Config } from './shared.js';
import { applyConfigPatch, parseSchedule } from './validate.js';

const config: Config = {
	pin: '123456',
	wakePhrase: 'hey buddy',
	volume: { default: 40, max: 80, step: 10, quietHours: null },
	audio: { mpvDevice: 'auto', recordCommand: 'arecord' },
	folders: {},
	radio: { defaultStation: 'a', stations: [{ id: 'a', name: 'A', url: 'https://a.example/stream' }] },
	lcd: { enabled: true, address: '0x27', backlightTimeoutSec: 30, darkHours: null },
	bluetooth: { enabled: false },
	weather: { place: '', latitude: null, longitude: null, units: 'fahrenheit' },
	voice: { restricted: false, allowed: [], hours: null },
};

describe('parseSchedule', () => {
	it('requires something to play for play schedules', () => {
		expect(() => parseSchedule({ time: '19:30', days: [1], action: 'play' })).toThrow(/folder or radio/);
	});

	it('drops the play target from stop schedules and dedupes days', () => {
		const schedule = parseSchedule({ time: '20:15', days: [3, 1, 1], action: 'stop', folder: 'x' });
		expect(schedule).toMatchObject({ action: 'stop', days: [1, 3] });
		expect(schedule.folder).toBeUndefined();
	});

	it('rejects invalid times', () => {
		expect(() => parseSchedule({ time: '25:00', days: [1], action: 'stop' })).toThrow();
	});
});

describe('applyConfigPatch', () => {
	it('keeps the default volume within the maximum', () => {
		expect(applyConfigPatch(config, { volume: { default: 90, max: 60, step: 5, quietHours: null } }).volume).toEqual({ default: 60, max: 60, step: 5, quietHours: null });
	});

	it('rejects single-word wake phrases', () => {
		expect(() => applyConfigPatch(config, { wakePhrase: 'buddy' })).toThrow(/two words/);
	});

	it('falls back to the first station when the default is removed', () => {
		const radio = {
			defaultStation: 'a',
			stations: [{ id: 'b', name: 'B', url: 'https://b.example/stream' }],
		};
		expect(applyConfigPatch(config, { radio }).radio.defaultStation).toBe('b');
	});

	it('does not mutate the original config', () => {
		applyConfigPatch(config, { wakePhrase: 'okay moon' });
		expect(config.wakePhrase).toBe('hey buddy');
	});
});

describe('voice allowlist', () => {
	it('keeps only known command types', () => {
		const voice = applyConfigPatch({ ...config, voice: { restricted: false, allowed: [], hours: null } }, {
			voice: { restricted: true, allowed: ['stop', 'play-folder', 'launch-rockets' as never], hours: null },
		}).voice;
		expect(voice).toEqual({ restricted: true, allowed: ['play-folder', 'stop'], hours: null });
	});
});

describe('night volume', () => {
	it('accepts a valid window and rejects bad times', () => {
		const quietHours = { start: '20:00', end: '07:00', max: 30 };
		expect(applyConfigPatch(config, { volume: { ...config.volume, quietHours } }).volume.quietHours).toEqual(quietHours);
		expect(() => applyConfigPatch(config, { volume: { ...config.volume, quietHours: { ...quietHours, start: '8pm' } } })).toThrow(/20:00/);
	});
});

describe('voice lockdown hours', () => {
	it('rejects badly formatted times', () => {
		expect(() => applyConfigPatch(config, { voice: { ...config.voice, hours: { start: '7pm', end: '07:00' } } })).toThrow(/19:00/);
	});
});
