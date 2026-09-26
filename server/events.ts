import { EventEmitter } from 'node:events';
import type { LcdState, PlayerState, VoiceStatus } from './shared.js';

interface EventMap {
	player: [PlayerState];
	voice: [VoiceStatus];
	lcd: [LcdState];
}

export const events = new EventEmitter<EventMap>();
// Each open portal tab adds SSE listeners, so the default limit of 10 is too low.
events.setMaxListeners(50);
