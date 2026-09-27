import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { findStation } from './actions.js';
import { spokenWeather } from './answers.js';
import { applyBluetooth } from './bluetooth.js';
import { checkPin, isAuthenticated, issueSession, lockedUntilTime, logout, requireAuth } from './auth.js';
import { store } from './config.js';
import { events } from './events.js';
import { getLcdState } from './lcd.js';
import { folderSettings, listFolders, scanLibrary } from './library.js';
import * as player from './player.js';
import { nextRun } from './scheduler.js';
import type { FolderSettings, PublicConfig, Schedule, Status } from './shared.js';
import { applyConfigPatch, parseFolderSettings, parseSchedule } from './validate.js';
import { getVoiceStatus, handleText, refreshVoice } from './voice.js';

export const api = new Hono();

function getStatus(): Status {
	return {
		player: player.getPlayerState(),
		voice: getVoiceStatus(),
		lcd: getLcdState(),
		next: nextRun(store.schedules, new Date()),
	};
}

function publicConfig(): PublicConfig {
	const { pin, ...rest } = store.config;
	return rest;
}

api.onError((err, c) => c.json({ error: err.message }, 400));

api.get('/session', (c) => c.json({ authenticated: isAuthenticated(c), lockedUntil: lockedUntilTime() }));

api.post('/login', async (c) => {
	const { pin } = await c.req.json<{ pin?: string }>();
	if (checkPin(String(pin ?? ''))) {
		issueSession(c);
		return c.json({ ok: true });
	}
	const lockedUntil = lockedUntilTime();
	return c.json({ error: lockedUntil ? 'Too many tries. Try again later.' : 'Wrong PIN', lockedUntil }, 401);
});

api.post('/logout', (c) => {
	logout(c);
	return c.json({ ok: true });
});

api.use('*', requireAuth);

api.get('/status', (c) => c.json(getStatus()));

api.get('/events', (c) => streamSSE(c, async (stream) => {
	const send = (event: string) => (data: unknown) => void stream.writeSSE({ event, data: JSON.stringify(data) });
	const onPlayer = send('player');
	const onVoice = send('voice');
	const onLcd = send('lcd');
	events.on('player', onPlayer);
	events.on('voice', onVoice);
	events.on('lcd', onLcd);
	// Cloudflare closes idle connections after about 100 seconds.
	const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 30_000);
	await new Promise<void>((resolve) => stream.onAbort(resolve));
	clearInterval(ping);
	events.off('player', onPlayer);
	events.off('voice', onVoice);
	events.off('lcd', onLcd);
}));

api.post('/player/play', async (c) => {
	const { folder, stationId } = await c.req.json<{ folder?: string; stationId?: string }>();
	if (folder) {
		await player.playFolder(folder);
	} else {
		const station = findStation(stationId);
		if (!station) {
			throw new Error('Station not found');
		}
		await player.playStation(station);
	}
	return c.json(player.getPlayerState());
});

const transport = { stop: player.stop, pause: player.pause, resume: player.resume, next: player.next, restart: player.restart };

api.post('/player/:action{stop|pause|resume|next|restart}', async (c) => {
	await transport[c.req.param('action') as keyof typeof transport]();
	return c.json(player.getPlayerState());
});

api.put('/player/volume', async (c) => {
	const { volume } = await c.req.json<{ volume: number }>();
	await player.setVolume(Number(volume), true);
	return c.json(player.getPlayerState());
});

api.get('/library', (c) => c.json(listFolders()));

api.post('/library/rescan', async (c) => {
	const folders = await scanLibrary();
	refreshVoice();
	return c.json(folders);
});

api.put('/library/:name', async (c) => {
	const name = c.req.param('name');
	if (!listFolders().some((f) => f.name === name)) {
		return c.json({ error: 'Folder not found' }, 404);
	}
	const input = await c.req.json<Partial<FolderSettings>>();
	store.config.folders[name] = parseFolderSettings(input, folderSettings(name));
	await store.saveConfig();
	refreshVoice();
	return c.json(listFolders());
});

api.get('/config', (c) => c.json(publicConfig()));

api.put('/config', async (c) => {
	const patch = await c.req.json<Partial<PublicConfig>>();
	const recordCommand = store.config.audio.recordCommand;
	const bluetooth = store.config.bluetooth.enabled;
	store.config = applyConfigPatch(store.config, patch);
	await store.saveConfig();
	refreshVoice(store.config.audio.recordCommand !== recordCommand);
	if (store.config.bluetooth.enabled !== bluetooth) {
		applyBluetooth(store.config.bluetooth.enabled);
	}
	await player.setVolume(player.getPlayerState().volume);
	return c.json(publicConfig());
});

api.put('/pin', async (c) => {
	const { current, next } = await c.req.json<{ current?: string; next?: string }>();
	if (!checkPin(String(current ?? ''))) {
		return c.json({ error: 'Current PIN is wrong' }, 400);
	}
	if (!/^\d{4,10}$/.test(String(next ?? ''))) {
		return c.json({ error: 'New PIN must be 4 to 10 digits' }, 400);
	}
	store.config.pin = String(next);
	await store.saveConfig();
	issueSession(c);
	return c.json({ ok: true });
});

api.get('/schedules', (c) => c.json(store.schedules));

api.put('/schedules', async (c) => {
	const input = await c.req.json<Partial<Schedule>[]>();
	store.schedules = input.map(parseSchedule);
	const ids = new Set(store.schedules.map((s) => s.id));
	store.state.lastFired = Object.fromEntries(Object.entries(store.state.lastFired).filter(([id]) => ids.has(id)));
	await Promise.all([store.saveSchedules(), store.saveState()]);
	return c.json(store.schedules);
});

interface RadioBrowserStation {
	name: string;
	url_resolved: string;
	country: string;
	codec: string;
	bitrate: number;
	tags: string;
}

interface GeocodingResult {
	name: string;
	admin1?: string;
	country?: string;
	latitude: number;
	longitude: number;
}

api.get('/weather/places', async (c) => {
	const query = c.req.query('q')?.trim();
	if (!query) {
		return c.json([]);
	}
	const params = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' });
	const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal: AbortSignal.timeout(8000) });
	if (!res.ok) {
		throw new Error(`City search failed (${res.status})`);
	}
	const { results = [] } = await res.json() as { results?: GeocodingResult[] };
	return c.json(results.map((r) => ({
		place: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
		latitude: r.latitude,
		longitude: r.longitude,
	})));
});

// Lets Settings preview the spoken weather sentence without a microphone.
api.get('/weather', async (c) => c.json({ text: await spokenWeather() }));

api.get('/radio/search', async (c) => {
	const query = c.req.query('q')?.trim();
	if (!query) {
		return c.json([]);
	}
	const params = new URLSearchParams({ name: query, limit: '25', hidebroken: 'true', order: 'votes', reverse: 'true' });
	const res = await fetch(`https://all.api.radio-browser.info/json/stations/search?${params}`, {
		headers: { 'User-Agent': 'sleepy-kid-assistant/0.1' },
		signal: AbortSignal.timeout(8000),
	});
	if (!res.ok) {
		throw new Error(`Radio search failed (${res.status})`);
	}
	const stations = await res.json() as RadioBrowserStation[];
	return c.json(stations.map((s) => ({
		name: s.name.trim(),
		url: s.url_resolved,
		country: s.country,
		codec: s.codec,
		bitrate: s.bitrate,
		tags: s.tags,
	})));
});

api.post('/voice/simulate', async (c) => {
	const { text } = await c.req.json<{ text: string }>();
	await handleText(String(text ?? ''));
	return c.json(getVoiceStatus());
});
