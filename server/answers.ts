import { store } from './config.js';

const WEATHER_CACHE_MS = 10 * 60_000;

function partOfDay(hour: number) {
	if (hour >= 5 && hour < 12) {
		return 'in the morning';
	}
	if (hour >= 12 && hour < 17) {
		return 'in the afternoon';
	}
	if (hour >= 17 && hour < 21) {
		return 'in the evening';
	}
	return 'at night';
}

// Written out for espeak, which reads "7:05" as "seven zero five".
export function spokenTime(date: Date) {
	const hour = date.getHours();
	const minute = date.getMinutes();
	if (hour === 12 && minute === 0) {
		return "It's noon";
	}
	if (hour === 0 && minute === 0) {
		return "It's midnight";
	}
	let minutes = String(minute);
	if (minute === 0) {
		minutes = "o'clock";
	} else if (minute < 10) {
		minutes = `oh ${minute}`;
	}
	return `It's ${hour % 12 || 12} ${minutes} ${partOfDay(hour)}`;
}

export function ordinal(n: number) {
	const lastTwo = n % 100;
	if (lastTwo >= 11 && lastTwo <= 13) {
		return `${n}th`;
	}
	const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
	return `${n}${suffix}`;
}

export function spokenDay(date: Date) {
	const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
	const month = date.toLocaleDateString('en-US', { month: 'long' });
	return `Today is ${weekday}, ${month} ${ordinal(date.getDate())}`;
}

// Open-Meteo reports WMO weather codes; each word must fit "It's 54 degrees and ___".
export function weatherWord(code: number, isDay: boolean) {
	if (code === 0) {
		return isDay ? 'sunny' : 'clear';
	}
	if (code === 1) {
		return isDay ? 'mostly sunny' : 'mostly clear';
	}
	if (code === 2) {
		return 'partly cloudy';
	}
	if (code === 3) {
		return 'cloudy';
	}
	if (code === 45 || code === 48) {
		return 'foggy';
	}
	if (code >= 51 && code <= 57) {
		return 'drizzly';
	}
	if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
		return 'rainy';
	}
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
		return 'snowy';
	}
	if (code >= 95) {
		return 'stormy';
	}
	return 'cloudy';
}

let cached: { key: string; at: number; text: string } | null = null;

export async function spokenWeather() {
	const { latitude, longitude, units } = store.config.weather;
	if (latitude === null || longitude === null) {
		return "Weather isn't set up yet. Ask a grown up to pick a city in Settings.";
	}
	const key = `${latitude},${longitude},${units}`;
	if (cached && cached.key === key && Date.now() - cached.at < WEATHER_CACHE_MS) {
		return cached.text;
	}
	const params = new URLSearchParams({
		latitude: String(latitude),
		longitude: String(longitude),
		current: 'temperature_2m,weather_code,is_day',
		temperature_unit: units,
	});
	try {
		const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		const { current } = await res.json() as { current: { temperature_2m: number; weather_code: number; is_day: number } };
		const text = `It's ${Math.round(current.temperature_2m)} degrees and ${weatherWord(current.weather_code, current.is_day === 1)}`;
		cached = { key, at: Date.now(), text };
		return text;
	} catch (err) {
		// A spoken apology beats a bare error chime for a child; the real cause goes to the journal.
		console.error(`[weather] lookup failed: ${(err as Error).message}`);
		return "Sorry, I couldn't get the weather right now";
	}
}
