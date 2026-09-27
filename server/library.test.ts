import { describe, expect, it } from 'vitest';
import { displayTitle, trackTitle } from './library.js';

describe('trackTitle', () => {
	it('drops the ordering number and extension', () => {
		expect(trackTitle('/media/stories/01 the sleepy unicorn.mp3')).toBe('the sleepy unicorn');
		expect(trackTitle('12-Goodnight_Moon.m4a')).toBe('goodnight moon');
	});

	it('keeps numbers that are part of the title', () => {
		expect(trackTitle('03 the 3 little pigs.mp3')).toBe('the 3 little pigs');
	});
});

describe('displayTitle', () => {
	it('strips the ordering number and file extension from filenames', () => {
		expect(displayTitle('01 Unicorns.mp3')).toBe('Unicorns');
		expect(displayTitle('07 - The_Brave_Owl.m4a')).toBe('The Brave Owl');
	});

	it('leaves tag titles and radio song titles alone', () => {
		expect(displayTitle('10cc - I\'m Not in Love')).toBe('10cc - I\'m Not in Love');
		expect(displayTitle('01 Unicorns')).toBe('01 Unicorns');
	});

	it('keeps a name that is only a number', () => {
		expect(displayTitle('1984.mp3')).toBe('1984');
	});
});
