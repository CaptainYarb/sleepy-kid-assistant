import { describe, expect, it } from 'vitest';
import { buildGrammar, parseCommand, splitWake } from './commands.js';

const folders = [
	{ name: 'Sleep Sounds', spokenName: 'sleep sounds' },
	{ name: 'stories', spokenName: 'stories' },
];

describe('splitWake', () => {
	it('detects the wake phrase alone', () => {
		expect(splitWake('hey buddy', 'hey buddy')).toEqual({ woke: true, rest: '' });
	});

	it('splits wake phrase and command in one utterance', () => {
		expect(splitWake('Hey Buddy, play stories', 'hey buddy')).toEqual({ woke: true, rest: 'play stories' });
	});

	it('does not treat a partial word match as the wake phrase', () => {
		expect(splitWake('hey buddyplay', 'hey buddy').woke).toBe(false);
	});

	it('ignores vosk unknown-word noise around the wake phrase', () => {
		expect(splitWake('[unk] hey buddy stop', 'hey buddy')).toEqual({ woke: true, rest: 'stop' });
		expect(splitWake('hey buddy [unk] stop', 'hey buddy')).toEqual({ woke: true, rest: 'stop' });
	});
});

describe('parseCommand', () => {
	it('maps folder spoken names to the folder on disk', () => {
		expect(parseCommand('play sleep sounds', folders)).toEqual({ type: 'play-folder', folder: 'Sleep Sounds' });
	});

	it('prefers radio for "play music" even if no folder matches', () => {
		expect(parseCommand('play music', folders)).toEqual({ type: 'play-radio' });
	});

	it('understands synonyms for transport controls', () => {
		expect(parseCommand('skip', folders)).toEqual({ type: 'next' });
		expect(parseCommand('volume down', folders)).toEqual({ type: 'quieter' });
	});

	it('returns null for anything else', () => {
		expect(parseCommand('play dinosaurs', folders)).toBeNull();
		expect(parseCommand('hello', folders)).toBeNull();
	});
});

describe('buildGrammar', () => {
	it('accepts commands with and without the wake phrase', () => {
		const grammar = buildGrammar('hey buddy', folders);
		expect(grammar).toContain('hey buddy');
		expect(grammar).toContain('play stories');
		expect(grammar).toContain('hey buddy play sleep sounds');
		expect(grammar.at(-1)).toBe('[unk]');
	});
});
