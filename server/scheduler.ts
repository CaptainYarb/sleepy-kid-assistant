import { findStation, runCommand } from './actions.js';
import { store } from './config.js';
import * as player from './player.js';
import type { NextRun, Schedule } from './shared.js';
import { hhmm, pad } from './time.js';

const TICK_MS = 20_000;

// Identifies one scheduled minute so a schedule fires once even though the tick runs several times per minute.
export function fireKey(date: Date) {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmm(date)}`;
}

export function isDue(schedule: Schedule, now: Date, lastFired?: string) {
	return schedule.enabled
		&& schedule.days.includes(now.getDay())
		&& schedule.time === hhmm(now)
		&& lastFired !== fireKey(now);
}

// When the schedule runs on the day `offset` days from `now`, or null if it does not run that day.
function occurrence(schedule: Schedule, now: Date, offset: number) {
	const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
	if (!schedule.enabled || !schedule.days.includes(day.getDay())) {
		return null;
	}
	const [hours, minutes] = schedule.time.split(':').map(Number);
	day.setHours(hours, minutes, 0, 0);
	return day.getTime();
}

export function nextRun(schedules: Schedule[], now: Date): NextRun | null {
	for (let offset = 0; offset <= 7; offset++) {
		let best: NextRun | null = null;
		for (const schedule of schedules) {
			const at = occurrence(schedule, now, offset);
			if (at !== null && at > now.getTime() && (!best || at < best.at)) {
				best = { at, schedule };
			}
		}
		if (best) {
			return best;
		}
	}
	return null;
}

// The most recent schedule event at or before `now`, looking back up to a week.
export function lastRun(schedules: Schedule[], now: Date): NextRun | null {
	for (let offset = 0; offset >= -7; offset--) {
		let best: NextRun | null = null;
		for (const schedule of schedules) {
			const at = occurrence(schedule, now, offset);
			if (at !== null && at <= now.getTime() && (!best || at > best.at)) {
				best = { at, schedule };
			}
		}
		if (best) {
			return best;
		}
	}
	return null;
}

async function runSchedule(schedule: Schedule) {
	if (schedule.action === 'stop') {
		return runCommand({ type: 'stop' });
	}
	if (schedule.folder) {
		return player.playFolder(schedule.folder, 0, schedule.id);
	}
	const station = findStation(schedule.stationId);
	if (!station) {
		throw new Error('Station not found');
	}
	return player.playStation(station, schedule.id);
}

async function tick() {
	const now = new Date();
	for (const schedule of store.schedules) {
		if (!isDue(schedule, now, store.state.lastFired[schedule.id])) {
			continue;
		}
		store.state.lastFired[schedule.id] = fireKey(now);
		await store.saveState();
		console.log(`[scheduler] ${schedule.time} ${schedule.action} ${schedule.folder ?? schedule.stationId ?? ''}`);
		try {
			await runSchedule(schedule);
		} catch (err) {
			console.error('[scheduler]', (err as Error).message);
		}
	}
}

export function startScheduler() {
	void tick();
	setInterval(() => void tick(), TICK_MS);
}
