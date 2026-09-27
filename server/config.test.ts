import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Test files run in parallel, so this one gets its own data folder rather than corrupting the shared one.
const sharedDataDir = process.env.DATA_DIR;
let dataDir = '';

beforeEach(() => {
	dataDir = mkdtempSync(path.join(os.tmpdir(), 'sleepy-config-test-'));
	process.env.DATA_DIR = dataDir;
	vi.resetModules();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	process.env.DATA_DIR = sharedDataDir;
	rmSync(dataDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe('data files', () => {
	it('sets a corrupt file aside and starts with defaults instead of crash-looping', async () => {
		// What a power cut mid-write can leave behind.
		writeFileSync(path.join(dataDir, 'state.json'), '{"volume": 40, "playb');
		const { store } = await import('./config.js');
		expect(store.state).toEqual({ volume: null, lastFired: {} });
		expect(existsSync(path.join(dataDir, 'state.json'))).toBe(false);
		expect(readdirSync(dataDir).some((f) => f.startsWith('state.json.corrupt-'))).toBe(true);
	});

	it('writes files that read back intact', async () => {
		const { store } = await import('./config.js');
		store.state.volume = 55;
		await store.saveState();
		vi.resetModules();
		const reloaded = await import('./config.js');
		expect(reloaded.store.state.volume).toBe(55);
	});
});
