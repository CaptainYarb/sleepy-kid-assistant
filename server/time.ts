import type { TimeRange } from './shared.js';

export const pad = (n: number) => String(n).padStart(2, '0');

export function hhmm(date: Date) {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function inTimeRange(time: string, range: TimeRange) {
	if (range.start <= range.end) {
		return time >= range.start && time < range.end;
	}
	// Ranges like 20:00-07:00 wrap past midnight.
	return time >= range.start || time < range.end;
}
