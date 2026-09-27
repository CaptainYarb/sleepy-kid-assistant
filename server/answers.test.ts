import { describe, expect, it } from 'vitest';
import { ordinal, spokenDay, spokenTime, spokenTomorrow, weatherWord } from './answers.js';

const at = (time: string) => new Date(`2026-09-26T${time}:00`);

describe('spokenTime', () => {
	it('says minutes the way a person would', () => {
		expect(spokenTime(at('19:30'))).toBe("It's 7 30 in the evening");
		expect(spokenTime(at('07:05'))).toBe("It's 7 oh 5 in the morning");
		expect(spokenTime(at('15:00'))).toBe("It's 3 o'clock in the afternoon");
	});

	it('handles noon, midnight and late night', () => {
		expect(spokenTime(at('12:00'))).toBe("It's noon");
		expect(spokenTime(at('00:00'))).toBe("It's midnight");
		expect(spokenTime(at('00:15'))).toBe("It's 12 15 at night");
		expect(spokenTime(at('22:45'))).toBe("It's 10 45 at night");
	});
});

describe('spokenDay', () => {
	it('names the weekday, month and ordinal date', () => {
		expect(spokenDay(at('09:00'))).toBe('Today is Saturday, September 26th');
	});
});

describe('ordinal', () => {
	it('uses th for the teens and st/nd/rd elsewhere', () => {
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
	});
});

describe('weatherWord', () => {
	it('says sunny by day and clear at night', () => {
		expect(weatherWord(0, true)).toBe('sunny');
		expect(weatherWord(0, false)).toBe('clear');
	});

	it('groups showers with rain and thunder as stormy', () => {
		expect(weatherWord(81, true)).toBe('rainy');
		expect(weatherWord(95, true)).toBe('stormy');
	});
});

describe('spokenTomorrow', () => {
	it('names the next calendar day, rolling over months', () => {
		expect(spokenTomorrow(at('21:00'))).toBe('Tomorrow is Sunday, September 27th');
		expect(spokenTomorrow(new Date('2026-09-30T23:30:00'))).toBe('Tomorrow is Thursday, October 1st');
	});

	it('stays on the right day across a daylight saving change', () => {
		// US clocks spring forward on 2026-03-08, a 23-hour day, so adding 24 hours at 23:30 the night before would skip to Monday.
		expect(spokenTomorrow(new Date('2026-03-07T23:30:00'))).toBe('Tomorrow is Sunday, March 8th');
	});
});
