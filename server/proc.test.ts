import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stopProcess } from './proc.js';

describe('stopProcess', () => {
	it('is a no-op for a child whose spawn failed, instead of signalling our own process group', async () => {
		const child = spawn('sleepy-definitely-missing-binary');
		const failed = new Promise((resolve) => child.on('error', resolve));
		// Called before the spawn error is emitted, which is when a bare kill() would signal pid 0.
		stopProcess(child);
		stopProcess(child, { group: true });
		await failed;
		expect(child.pid).toBeUndefined();
	});
});
