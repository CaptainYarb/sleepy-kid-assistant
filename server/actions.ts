import { spokenDay, spokenTime, spokenWeather } from './answers.js';
import type { Command } from './commands.js';
import { store } from './config.js';
import * as player from './player.js';

export function findStation(id?: string) {
	const { stations, defaultStation } = store.config.radio;
	return stations.find((s) => s.id === (id || defaultStation)) ?? stations[0];
}

// Resolves to text to speak for question commands, and nothing for playback commands.
export async function runCommand(command: Command): Promise<string | void> {
	switch (command.type) {
		case 'play-folder':
			return player.playFolder(command.folder);
		case 'play-track':
			return player.playFolder(command.folder, command.index);
		case 'play-radio': {
			const station = findStation();
			if (!station) {
				throw new Error('No radio stations configured');
			}
			return player.playStation(station);
		}
		case 'stop':
			return player.stop();
		case 'pause':
			return player.pause();
		case 'resume':
			return player.resume();
		case 'next':
			return player.next();
		case 'louder':
			return player.changeVolume(1);
		case 'quieter':
			return player.changeVolume(-1);
		case 'max-volume':
			return player.maxVolume();
		case 'time':
			return spokenTime(new Date());
		case 'day':
			return spokenDay(new Date());
		case 'weather':
			return spokenWeather();
	}
}
