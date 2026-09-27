import { describe, expect, it } from 'vitest';
import { getVoiceStatus, handleText } from './voice.js';

describe('handleText', () => {
	it('drops speech without the wake phrase without logging it', async () => {
		await handleText('play stories');
		await handleText('stop');
		await handleText('what time is it');
		expect(getVoiceStatus().log).toEqual([]);
	});
});
