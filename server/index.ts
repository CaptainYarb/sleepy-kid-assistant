import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { applyBluetooth } from './bluetooth.js';
import { DATA_DIR, MEDIA_DIR, ROOT_DIR, store } from './config.js';
import { startLcd, stopLcd } from './lcd.js';
import { scanLibrary } from './library.js';
import { chime, startPlayer, stopPlayer } from './player.js';
import { startResume } from './resume.js';
import { api } from './routes.js';
import { startScheduler } from './scheduler.js';
import { refreshVoice, startVoice, stopVoice } from './voice.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
// Parents copy MP3s over SSH/SMB, so the library is rescanned periodically instead of needing a button press.
const RESCAN_MS = 60_000;

// serveStatic resolves roots against the working directory, not this file.
const webRoot = path.relative(process.cwd(), path.join(ROOT_DIR, 'dist', 'web'));

const app = new Hono();
app.route('/api', api);
app.use('*', serveStatic({ root: webRoot }));
app.get('*', serveStatic({ root: webRoot, path: 'index.html' }));

applyBluetooth(store.config.bluetooth.enabled);
await scanLibrary();
startResume();
startPlayer();
startVoice();
startScheduler();
startLcd();

setInterval(async () => {
	await scanLibrary();
	refreshVoice();
}, RESCAN_MS);

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
	console.log(`[server] http://localhost:${PORT} (data: ${DATA_DIR}, media: ${MEDIA_DIR})`);
	// An audible "I'm up" after a boot, power cut or deploy; skipped in dev, where tsx restarts on every save.
	if (process.env.NODE_ENV === 'production') {
		chime('wake');
	}
});

function shutdown() {
	stopVoice();
	stopLcd();
	stopPlayer();
	process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
