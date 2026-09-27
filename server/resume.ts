import { findStation } from './actions.js';
import { store } from './config.js';
import { events } from './events.js';
import * as player from './player.js';
import { lastRun, nextRun } from './scheduler.js';
import type { Config, Playback, Schedule } from './shared.js';

// Often enough to resume close to where a story stopped, rare enough to spare the SD card.
const SAVE_MS = 15_000;

let restoring = false;

export function shouldResume(playback: Playback, resume: Config['resume'], schedules: Schedule[], now: Date) {
	if (!resume.enabled) {
		return false;
	}
	// Scheduled playback resumes however long the outage was, as long as no later schedule event has taken over.
	if (playback.scheduleId && lastRun(schedules, now)?.schedule.id === playback.scheduleId) {
		return true;
	}
	if (now.getTime() - playback.savedAt > resume.withinMinutes * 60_000) {
		return false;
	}
	// A stop schedule that would have fired during the outage wins over resuming.
	const stop = nextRun(schedules.filter((s) => s.action === 'stop'), new Date(playback.savedAt));
	return !stop || stop.at > now.getTime();
}

async function save() {
	// While mpv is down, or mid-restore, the player looks stopped; saving then would erase the session we want back.
	if (restoring || !player.getPlayerState().available) {
		return;
	}
	let playback: Playback | null;
	try {
		playback = await player.snapshot();
	} catch {
		// Between tracks mpv has no position yet; the next save will catch it.
		return;
	}
	if (!playback && !store.state.playback) {
		return;
	}
	store.state.playback = playback;
	await store.saveState();
}

async function restore() {
	const playback = store.state.playback;
	if (!playback || !shouldResume(playback, store.config.resume, store.schedules, new Date())) {
		return;
	}
	restoring = true;
	try {
		if (playback.source.type === 'radio') {
			const station = findStation(playback.source.id);
			if (station && !playback.paused) {
				await player.playStation(station, playback.scheduleId);
			}
		} else {
			await player.restoreFolder(playback);
		}
		console.log(`[resume] picked up ${playback.source.label}${playback.position ? ` at ${playback.position}s` : ''}`);
	} catch (err) {
		console.error('[resume]', (err as Error).message);
	} finally {
		restoring = false;
	}
}

export function startResume() {
	let wasAvailable = false;
	let lastKey = '';
	events.on('player', (state) => {
		// Covers the first start, a crashed mpv coming back, and a restart after a deploy.
		if (state.available && !wasAvailable) {
			void restore();
		}
		wasAvailable = state.available;
		// Save right away on stop, pause or a new track so a power cut straight after never resumes stale state.
		const key = `${state.status}:${state.source?.label}:${state.track}`;
		if (key !== lastKey) {
			lastKey = key;
			void save();
		}
	});
	setInterval(() => void save(), SAVE_MS);
}
