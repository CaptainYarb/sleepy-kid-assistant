import { describe, expect, it } from 'vitest';
import type { Config } from './shared.js';
import { applyConfigPatch, parseSchedule } from './validate.js';

const config: Config = {
	pin: '123456',
	wakePhrase: 'hey buddy',
	volume: { default: 40, max: 80, step: 10 },
	audio: { mpvDevice: 'auto', recordCommand: 'arecord' },
	folders: {},
	radio: { defaultStation: 'a', stations: [{ id: 'a', name: 'A', url: 'https://a.example/stream' }] },
	lcd: { enabled: true, address: '0x27', backlightTimeoutSec: 30, darkHours: null },
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
		expect(applyConfigPatch(config, { volume: { default: 90, max: 60, step: 5 } }).volume).toEqual({ default: 60, max: 60, step: 5 });
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
