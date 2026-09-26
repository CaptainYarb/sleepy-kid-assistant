export type Command =
	| { type: 'play-folder'; folder: string }
	| { type: 'play-radio' }
	| { type: 'stop' }
	| { type: 'pause' }
	| { type: 'resume' }
	| { type: 'next' }
	| { type: 'louder' }
	| { type: 'quieter' };

export interface VoiceFolder {
	name: string;
	spokenName: string;
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
	'play music': { type: 'play-radio' },
	'play the radio': { type: 'play-radio' },
};

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

export function parseCommand(text: string, folders: VoiceFolder[]): Command | null {
	const clean = normalize(text);
	const fixed = FIXED_PHRASES[clean];
	if (fixed) {
		return fixed;
	}
	if (clean.startsWith('play ')) {
		const target = clean.slice('play '.length);
		const folder = folders.find((f) => normalize(f.spokenName) === target);
		if (folder) {
			return { type: 'play-folder', folder: folder.name };
		}
	}
	return null;
}

// Vosk accuracy on a Pi 2 depends on a small closed grammar, so every accepted utterance is listed explicitly.
export function buildGrammar(wakePhrase: string, folders: VoiceFolder[]) {
	const wake = normalize(wakePhrase);
	const commands = [
		...Object.keys(FIXED_PHRASES),
		...folders.map((f) => `play ${normalize(f.spokenName)}`),
	];
	const phrases = new Set([wake, ...commands, ...commands.map((c) => `${wake} ${c}`)]);
	return [...phrases, '[unk]'];
}

export function describeCommand(command: Command) {
	if (command.type === 'play-folder') {
		return `play ${command.folder}`;
	}
	return command.type.replace('-', ' ');
}
