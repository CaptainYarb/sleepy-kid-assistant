import { findStation, runCommand } from './actions.js';
import { store } from './config.js';
import * as player from './player.js';
import type { NextRun, Schedule } from './shared.js';

const TICK_MS = 20_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function hhmm(date: Date) {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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

export function nextRun(schedules: Schedule[], now: Date): NextRun | null {
	let best: NextRun | null = null;
	for (let offset = 0; offset <= 7; offset++) {
		for (const schedule of schedules) {
			const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
			if (!schedule.enabled || !schedule.days.includes(day.getDay())) {
				continue;
			}
			const [hours, minutes] = schedule.time.split(':').map(Number);
			day.setHours(hours, minutes, 0, 0);
			if (day > now && (!best || day.getTime() < best.at)) {
				best = { at: day.getTime(), schedule };
			}
		}
		if (best) {
			return best;
		}
	}
	return best;
}

async function runSchedule(schedule: Schedule) {
	if (schedule.action === 'stop') {
		return runCommand({ type: 'stop' });
	}
	if (schedule.folder) {
		return runCommand({ type: 'play-folder', folder: schedule.folder });
	}
	const station = findStation(schedule.stationId);
	if (!station) {
		throw new Error('Station not found');
	}
	return player.playStation(station);
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
