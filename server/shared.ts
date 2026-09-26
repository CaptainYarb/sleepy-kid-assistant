// Types shared by the server and the web portal. Keep this file type-only.

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

export interface Config {
	pin: string;
	wakePhrase: string;
	volume: { default: number; max: number; step: number };
	audio: { mpvDevice: string; recordCommand: string };
	folders: Record<string, FolderSettings>;
	radio: { defaultStation: string; stations: Station[] };
	lcd: { enabled: boolean; address: string; backlightTimeoutSec: number; darkHours: TimeRange | null };
	bluetooth: { enabled: boolean };
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
}

export interface VoiceEntry {
	at: number;
	text: string;
	result: string;
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
