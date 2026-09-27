import { afterEach, describe, expect, it } from 'vitest';
import { store } from './config.js';
import { maxAllowed } from './player.js';

const at = (time: string) => new Date(`2026-09-26T${time}:00`);
const original = structuredClone(store.config.volume);

afterEach(() => {
	store.config.volume = structuredClone(original);
});

describe('maxAllowed', () => {
	it('uses the night max inside a window that wraps past midnight', () => {
		store.config.volume = { ...original, max: 80, quietHours: { start: '20:00', end: '07:00', max: 30 } };
		expect(maxAllowed(at('21:00'))).toBe(30);
		expect(maxAllowed(at('06:30'))).toBe(30);
		expect(maxAllowed(at('12:00'))).toBe(80);
	});

	it('never lets the night max exceed the normal max', () => {
		store.config.volume = { ...original, max: 50, quietHours: { start: '20:00', end: '07:00', max: 90 } };
		expect(maxAllowed(at('22:00'))).toBe(50);
	});

	it('uses the normal max when no night window is set', () => {
		store.config.volume = { ...original, max: 70, quietHours: null };
		expect(maxAllowed(at('23:00'))).toBe(70);
	});
});
