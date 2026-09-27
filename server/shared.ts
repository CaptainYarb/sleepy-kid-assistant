// Types shared by the server and the web portal. Keep this file type-only.

import type { Command } from './commands.js';

export type CommandType = Command['type'];

export interface FolderSettings {
	spokenName: string;
	shuffle: boolean;
	loop: boolean;
	enabled: boolean;
}

export interface Station {
	id: string;
	name: string;
	url: string;
}

export interface TimeRange {
	start: string;
	end: string;
}

export interface QuietHours extends TimeRange {
	max: number;
}

export interface Config {
	pin: string;
	wakePhrase: string;
	volume: { default: number; max: number; step: number; quietHours: QuietHours | null };
	audio: { mpvDevice: string; recordCommand: string };
	folders: Record<string, FolderSettings>;
	radio: { defaultStation: string; stations: Station[] };
	lcd: { enabled: boolean; address: string; backlightTimeoutSec: number; darkHours: TimeRange | null };
	bluetooth: { enabled: boolean };
	weather: { place: string; latitude: number | null; longitude: number | null; units: 'fahrenheit' | 'celsius' };
	// `hours` limits the lockdown to a time window; null means it applies all day.
	voice: { restricted: boolean; allowed: CommandType[]; hours: TimeRange | null };
}

export type PublicConfig = Omit<Config, 'pin'>;

export interface Schedule {
	id: string;
	enabled: boolean;
	time: string;
	days: number[];
	action: 'play' | 'stop';
	folder?: string;
	stationId?: string;
}

export interface Folder {
	name: string;
	trackCount: number;
	settings: FolderSettings;
}

export type PlayerSource =
	| { type: 'folder'; name: string; label: string }
	| { type: 'radio'; id: string; label: string };

export interface PlayerState {
	available: boolean;
	status: 'stopped' | 'playing' | 'paused';
	source: PlayerSource | null;
	track: string | null;
	volume: number;
	// The cap in effect right now, which is lower than the configured max during night hours.
	maxVolume: number;
}

export interface VoiceEntry {
	at: number;
	text: string;
	result: string;
	reply?: string;
}

export interface VoiceStatus {
	enabled: boolean;
	running: boolean;
	listening: boolean;
	problem: string | null;
	unknownWords: string[];
	log: VoiceEntry[];
}

export interface LcdState {
	lines: [string, string];
	backlight: boolean;
}

export interface NextRun {
	at: number;
	schedule: Schedule;
}

export interface Status {
	player: PlayerState;
	voice: VoiceStatus;
	lcd: LcdState;
	next: NextRun | null;
}
