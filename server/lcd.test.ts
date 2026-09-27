import { describe, expect, it } from 'vitest';
import { marquee, toLcdText } from './lcd.js';
import { inTimeRange } from './time.js';

describe('toLcdText', () => {
	it('keeps accented letters readable and replaces unsupported characters', () => {
		expect(toLcdText('Frère Jacques ♪')).toBe('Frere Jacques ?');
	});
});

describe('marquee', () => {
	it('pads short text to the full width', () => {
		expect(marquee('Hi', 0, 5)).toBe('Hi   ');
	});

	it('scrolls long text and wraps around', () => {
		expect(marquee('abcdefgh', 0, 4)).toBe('abcd');
		expect(marquee('abcdefgh', 2, 4)).toBe('cdef');
		expect(marquee('abcdefgh', 7, 4)).toBe('h   ');
		expect(marquee('abcdefgh', 11, 4)).toBe('abcd');
	});
});

describe('inTimeRange', () => {
	it('handles ranges that wrap past midnight', () => {
		const night = { start: '20:00', end: '07:00' };
		expect(inTimeRange('23:00', night)).toBe(true);
		expect(inTimeRange('06:59', night)).toBe(true);
		expect(inTimeRange('07:00', night)).toBe(false);
		expect(inTimeRange('12:00', night)).toBe(false);
	});

	it('handles same-day ranges', () => {
		expect(inTimeRange('13:30', { start: '13:00', end: '15:00' })).toBe(true);
		expect(inTimeRange('15:00', { start: '13:00', end: '15:00' })).toBe(false);
	});
});
