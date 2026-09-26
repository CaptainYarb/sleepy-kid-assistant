import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_DIR, store } from './config.js';
import type { Folder, FolderSettings } from './shared.js';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wav']);

let folders = new Map<string, string[]>();

// Vosk only matches lowercase words; digits are kept so parents notice them and spell them out in the portal.
export function toSpokenName(folderName: string) {
	return folderName
		.toLowerCase()
		.replace(/[-_.]+/g, ' ')
		.replace(/[^a-z0-9' ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function folderSettings(name: string): FolderSettings {
	const saved: Partial<FolderSettings> = store.config.folders[name] ?? {};
	return {
		spokenName: toSpokenName(name),
		shuffle: false,
		loop: true,
		enabled: true,
		...saved,
	};
}

async function walk(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await walk(full));
		} else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !entry.name.startsWith('.')) {
			files.push(full);
		}
	}
	return files;
}

export async function scanLibrary() {
	const next = new Map<string, string[]>();
	let entries: Dirent[];
	try {
		entries = await readdir(MEDIA_DIR, { withFileTypes: true });
	} catch {
		console.warn(`[library] media folder ${MEDIA_DIR} not found`);
		entries = [];
	}
	for (const entry of entries) {
		if (entry.isDirectory() && !entry.name.startsWith('.')) {
			const tracks = await walk(path.join(MEDIA_DIR, entry.name));
			tracks.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
			next.set(entry.name, tracks);
		}
	}
	folders = next;
	return listFolders();
}

export function listFolders(): Folder[] {
	return [...folders].map(([name, tracks]) => ({
		name,
		trackCount: tracks.length,
		settings: folderSettings(name),
	}));
}

export function getTracks(name: string) {
	return folders.get(name) ?? [];
}
