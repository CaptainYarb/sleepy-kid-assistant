import { describe, expect, it } from 'vitest';
import { buildGrammar, isAllowed, parseCommand, splitWake } from './commands.js';

const folders = [
	{ name: 'Sleep Sounds', spokenName: 'sleep sounds', tracks: ['rain', 'ocean waves'] },
	{ name: 'stories', spokenName: 'stories', tracks: ['the gruff goat'] },
	{
		name: 'Sleep Stories',
		spokenName: 'sleep stories',
		tracks: ['the sleepy unicorn', 'the unicorn and the dragon', 'goodnight moon'],
	},
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
		expect(grammar).toContain('hey buddy play unicorn in the sleep stories');
		expect(grammar).toContain('play the sleepy unicorn');
		expect(grammar).toContain('hey buddy');
		expect(grammar).toContain('play stories');
		expect(grammar).toContain('hey buddy play sleep sounds');
		expect(grammar.at(-1)).toBe('[unk]');
	});
});

describe('questions', () => {
	it('recognizes time, day and weather questions', () => {
		expect(parseCommand('what time is it', folders)).toEqual({ type: 'time' });
		expect(parseCommand('what day is it', folders)).toEqual({ type: 'day' });
		expect(parseCommand("what's the weather", folders)).toEqual({ type: 'weather' });
	});
});

describe('track search', () => {
	it('finds a track by one keyword, ignoring plurals', () => {
		expect(parseCommand('play unicorns', folders)).toMatchObject({ type: 'play-track', folder: 'Sleep Stories', index: 0 });
	});

	it('limits the search to the named folder', () => {
		expect(parseCommand('play unicorns in the sleep stories', folders)).toMatchObject({ folder: 'Sleep Stories', index: 0 });
		expect(parseCommand('play goodnight moon in sleep stories', folders)).toMatchObject({ folder: 'Sleep Stories', index: 2 });
		expect(parseCommand('play rain in the sleep stories', folders)).toBeNull();
	});

	it('prefers the closest title when several contain the words', () => {
		expect(parseCommand('play the unicorn and the dragon', folders)).toMatchObject({ index: 1 });
		expect(parseCommand('play dragon', folders)).toMatchObject({ index: 1 });
	});

	it('still treats an exact folder name as the whole folder', () => {
		expect(parseCommand('play sleep stories', folders)).toEqual({ type: 'play-folder', folder: 'Sleep Stories' });
	});

	it('ignores filler words so a lone "the story" matches nothing', () => {
		expect(parseCommand('play the story', folders)).toBeNull();
	});
});

describe('max volume', () => {
	it('understands both phrasings', () => {
		expect(parseCommand('volume to max', folders)).toEqual({ type: 'max-volume' });
		expect(parseCommand('max volume', folders)).toEqual({ type: 'max-volume' });
	});
});

describe('isAllowed', () => {
	const at = (time: string) => new Date(`2026-09-26T${time}:00`);
	const locked = { restricted: true, allowed: ['stop' as const], hours: null };

	it('allows everything when the lockdown is off', () => {
		expect(isAllowed('louder', { ...locked, restricted: false }, at('21:00'))).toBe(true);
	});

	it('applies the allowlist all day when no hours are set', () => {
		expect(isAllowed('louder', locked, at('12:00'))).toBe(false);
		expect(isAllowed('stop', locked, at('12:00'))).toBe(true);
	});

	it('only locks down inside the window, including past midnight', () => {
		const nightly = { ...locked, hours: { start: '19:00', end: '07:00' } };
		expect(isAllowed('louder', nightly, at('21:00'))).toBe(false);
		expect(isAllowed('louder', nightly, at('06:30'))).toBe(false);
		expect(isAllowed('louder', nightly, at('12:00'))).toBe(true);
	});
});
