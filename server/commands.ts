import type { Config } from './shared.js';
import { hhmm, inTimeRange } from './time.js';

export type Command =
	| { type: 'play-folder'; folder: string }
	| { type: 'play-track'; folder: string; index: number; title: string }
	| { type: 'play-radio' }
	| { type: 'stop' }
	| { type: 'pause' }
	| { type: 'resume' }
	| { type: 'next' }
	| { type: 'louder' }
	| { type: 'quieter' }
	| { type: 'max-volume' }
	| { type: 'time' }
	| { type: 'day' }
	| { type: 'tomorrow' }
	| { type: 'weather' };

// Every command type, for validating the voice allowlist; typed as a Record so a new command cannot be forgotten here.
const COMMAND_TYPE_FLAGS: Record<Command['type'], true> = {
	'play-folder': true,
	'play-track': true,
	'play-radio': true,
	'stop': true,
	'pause': true,
	'resume': true,
	'next': true,
	'louder': true,
	'quieter': true,
	'max-volume': true,
	'time': true,
	'day': true,
	'tomorrow': true,
	'weather': true,
};
export const COMMAND_TYPES = Object.keys(COMMAND_TYPE_FLAGS) as Command['type'][];

export interface VoiceFolder {
	name: string;
	spokenName: string;
	// Spoken track titles, in the same order as the folder's playlist.
	tracks: string[];
}

const FIXED_PHRASES: Record<string, Command> = {
	'stop': { type: 'stop' },
	'stop music': { type: 'stop' },
	'turn it off': { type: 'stop' },
	'pause': { type: 'pause' },
	'resume': { type: 'resume' },
	'keep playing': { type: 'resume' },
	'next': { type: 'next' },
	'next song': { type: 'next' },
	'skip': { type: 'next' },
	'louder': { type: 'louder' },
	'volume up': { type: 'louder' },
	'quieter': { type: 'quieter' },
	'softer': { type: 'quieter' },
	'volume down': { type: 'quieter' },
	'volume to max': { type: 'max-volume' },
	'max volume': { type: 'max-volume' },
	'play music': { type: 'play-radio' },
	'play the radio': { type: 'play-radio' },
	'what time is it': { type: 'time' },
	'what day is it': { type: 'day' },
	'what day is it tomorrow': { type: 'tomorrow' },
	'what day is tomorrow': { type: 'tomorrow' },
	'what is the weather': { type: 'weather' },
	"what's the weather": { type: 'weather' },
};

// Words that carry no meaning in a title, so "play the unicorn story" still finds "the sleepy unicorn".
const FILLER_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'on', 'at', 'to', 'with', 'story', 'part', 'chapter']);

export function normalize(text: string) {
	return text.toLowerCase().replace(/\[unk\]/g, ' ').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function splitWake(text: string, wakePhrase: string) {
	const clean = normalize(text);
	const wake = normalize(wakePhrase);
	if (clean === wake) {
		return { woke: true, rest: '' };
	}
	if (clean.startsWith(`${wake} `)) {
		return { woke: true, rest: clean.slice(wake.length + 1) };
	}
	return { woke: false, rest: clean };
}

export function keywords(title: string) {
	return [...new Set(normalize(title).split(' ').filter((word) => word && !FILLER_WORDS.has(word) && !/^\d+$/.test(word)))];
}

// Crude plural folding; it only has to treat "unicorns" and "unicorn" alike on both sides of the comparison.
function stem(word: string) {
	if (word.endsWith('ies') && word.length > 4) {
		return `${word.slice(0, -3)}y`;
	}
	if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
		return word.slice(0, -1);
	}
	return word;
}

function findTrack(query: string, folders: VoiceFolder[]): Command | null {
	const wanted = keywords(query).map(stem);
	if (!wanted.length) {
		return null;
	}
	let best: { command: Command; score: number; focus: number } | null = null;
	for (const folder of folders) {
		for (const [index, title] of folder.tracks.entries()) {
			const words = keywords(title).map(stem);
			const matched = wanted.filter((word) => words.includes(word)).length;
			const score = matched / wanted.length;
			// Prefers "unicorn" over "the unicorn and the dragon" when both contain every spoken word.
			const focus = matched / Math.max(words.length, 1);
			if (score >= 0.5 && (!best || score > best.score || (score === best.score && focus > best.focus))) {
				best = { command: { type: 'play-track', folder: folder.name, index, title }, score, focus };
			}
		}
	}
	return best?.command ?? null;
}

export function parseCommand(text: string, folders: VoiceFolder[]): Command | null {
	const clean = normalize(text);
	const fixed = FIXED_PHRASES[clean];
	if (fixed) {
		return fixed;
	}
	if (!clean.startsWith('play ')) {
		return null;
	}
	const target = clean.slice('play '.length);
	const folder = folders.find((f) => normalize(f.spokenName) === target);
	if (folder) {
		return { type: 'play-folder', folder: folder.name };
	}
	for (const scoped of folders) {
		const spoken = normalize(scoped.spokenName);
		for (const joiner of [' in the ', ' in ']) {
			if (target.endsWith(`${joiner}${spoken}`)) {
				return findTrack(target.slice(0, -(joiner.length + spoken.length)), [scoped]);
			}
		}
	}
	return findTrack(target, folders);
}

// Vosk accuracy on a Pi 2 depends on a small closed grammar, so every accepted utterance is listed explicitly.
export function buildGrammar(wakePhrase: string, folders: VoiceFolder[]) {
	const wake = normalize(wakePhrase);
	const commands = new Set(Object.keys(FIXED_PHRASES));
	for (const folder of folders) {
		const spoken = normalize(folder.spokenName);
		commands.add(`play ${spoken}`);
		for (const title of folder.tracks) {
			for (const target of new Set([normalize(title), ...keywords(title)])) {
				commands.add(`play ${target}`);
				commands.add(`play ${target} in ${spoken}`);
				commands.add(`play ${target} in the ${spoken}`);
			}
		}
	}
	const phrases = new Set([wake, ...commands, ...[...commands].map((c) => `${wake} ${c}`)]);
	return [...phrases, '[unk]'];
}

// Outside the lockdown window every command is allowed; inside it (or all day without a window) only the allowlist.
export function isAllowed(type: Command['type'], voice: Config['voice'], now: Date) {
	if (!voice.restricted) {
		return true;
	}
	if (voice.hours && !inTimeRange(hhmm(now), voice.hours)) {
		return true;
	}
	return voice.allowed.includes(type);
}

export function describeCommand(command: Command) {
	if (command.type === 'play-folder') {
		return `play ${command.folder}`;
	}
	if (command.type === 'play-track') {
		return `play ${command.title} (${command.folder})`;
	}
	return command.type.replace('-', ' ');
}
