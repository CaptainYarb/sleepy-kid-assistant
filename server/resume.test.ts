import { describe, expect, it } from 'vitest';
import { shouldResume } from './resume.js';
import type { Playback, Schedule } from './shared.js';

// 2026-09-26 is a Saturday; every schedule here runs daily.
const at = (day: number, time: string) => new Date(`2026-09-${day}T${time}:00`);
const daily = [0, 1, 2, 3, 4, 5, 6];
const bedtime: Schedule = { id: 'bedtime', enabled: true, time: '19:30', days: daily, action: 'play', folder: 'Sleep Sounds' };
const morningStop: Schedule = { id: 'morning', enabled: true, time: '07:00', days: daily, action: 'stop' };
const resume = { enabled: true, withinMinutes: 30 };
const playing = (savedAt: Date, extra: Partial<Playback> = {}): Playback => ({
	source: { type: 'folder', name: 'Sleep Sounds', label: 'Sleep Sounds' },
	paused: false,
	savedAt: savedAt.getTime(),
	...extra,
});

describe('shouldResume', () => {
	it('resumes a short outage and skips a long one', () => {
		expect(shouldResume(playing(at(26, '14:00')), resume, [], at(26, '14:20'))).toBe(true);
		expect(shouldResume(playing(at(26, '14:00')), resume, [], at(26, '15:00'))).toBe(false);
	});

	it('never resumes when turned off', () => {
		expect(shouldResume(playing(at(26, '14:00')), { ...resume, enabled: false }, [], at(26, '14:01'))).toBe(false);
	});

	it('skips a short outage if a stop schedule would have run during it', () => {
		const stop: Schedule = { ...morningStop, time: '14:10' };
		expect(shouldResume(playing(at(26, '14:00')), resume, [stop], at(26, '14:20'))).toBe(false);
	});

	it('resumes scheduled playback after a long outage while its schedule is still the latest', () => {
		// Bedtime sounds started at 19:30, power out from 02:00 to 05:00.
		const scheduled = playing(at(27, '02:00'), { scheduleId: 'bedtime' });
		expect(shouldResume(scheduled, resume, [bedtime, morningStop], at(27, '05:00'))).toBe(true);
	});

	it('does not resume scheduled playback once a later schedule event has passed', () => {
		const scheduled = playing(at(27, '02:00'), { scheduleId: 'bedtime' });
		expect(shouldResume(scheduled, resume, [bedtime, morningStop], at(27, '08:00'))).toBe(false);
	});

	it('falls back to the normal window when the schedule was deleted or disabled', () => {
		const scheduled = playing(at(27, '02:00'), { scheduleId: 'bedtime' });
		expect(shouldResume(scheduled, resume, [{ ...bedtime, enabled: false }], at(27, '05:00'))).toBe(false);
	});
});
