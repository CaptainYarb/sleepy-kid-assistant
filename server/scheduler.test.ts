import { describe, expect, it } from 'vitest';
import { fireKey, isDue, lastRun, nextRun } from './scheduler.js';
import type { Schedule } from './shared.js';

const bedtime: Schedule = { id: 'a', enabled: true, time: '19:30', days: [0, 1, 2, 3, 4], action: 'play', folder: 'stories' };
// 2026-09-28 is a Monday.
const mondayAt = (time: string) => new Date(`2026-09-28T${time}:15`);

describe('isDue', () => {
	it('fires at the matching minute on a scheduled day', () => {
		expect(isDue(bedtime, mondayAt('19:30'))).toBe(true);
	});

	it('does not fire at other minutes or on other days', () => {
		expect(isDue(bedtime, mondayAt('19:31'))).toBe(false);
		expect(isDue(bedtime, new Date('2026-10-02T19:30:00'))).toBe(false);
	});

	it('fires once per minute even across ticks or a restart', () => {
		const now = mondayAt('19:30');
		expect(isDue(bedtime, now, fireKey(now))).toBe(false);
	});

	it('fires again the next scheduled day', () => {
		const yesterday = new Date('2026-09-27T19:30:00');
		expect(isDue(bedtime, mondayAt('19:30'), fireKey(yesterday))).toBe(true);
	});

	it('never fires when disabled', () => {
		expect(isDue({ ...bedtime, enabled: false }, mondayAt('19:30'))).toBe(false);
	});
});

describe('nextRun', () => {
	it('finds the next time later today', () => {
		expect(nextRun([bedtime], mondayAt('18:00'))?.at).toBe(new Date('2026-09-28T19:30:00').getTime());
	});

	it('skips to the next scheduled day once today has passed', () => {
		// Thursday evening, next run is Sunday since Friday and Saturday are off.
		const next = nextRun([bedtime], new Date('2026-10-01T20:00:00'));
		expect(next?.at).toBe(new Date('2026-10-04T19:30:00').getTime());
	});

	it('returns null when nothing is enabled', () => {
		expect(nextRun([{ ...bedtime, enabled: false }], mondayAt('18:00'))).toBeNull();
	});
});

describe('lastRun', () => {
	it('finds the most recent event earlier today', () => {
		expect(lastRun([bedtime], mondayAt('20:00'))?.at).toBe(new Date('2026-09-28T19:30:00').getTime());
	});

	it('looks back to previous days, skipping days the schedule is off', () => {
		// Saturday morning: the last school-night run was Thursday evening.
		expect(lastRun([bedtime], new Date('2026-10-03T09:00:00'))?.at).toBe(new Date('2026-10-01T19:30:00').getTime());
	});

	it('counts the current minute as already run', () => {
		expect(lastRun([bedtime], mondayAt('19:30'))?.schedule.id).toBe('a');
	});
});
