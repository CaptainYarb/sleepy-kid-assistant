import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

// Prefixes every line, not every chunk, so multi-line tracebacks stay attributable in journalctl.
export function logLines(stream: Readable | null, tag: string) {
	if (stream) {
		createInterface({ input: stream }).on('line', (line) => console.error(`[${tag}] ${line}`));
	}
}

// A child whose spawn failed has no pid, and kill() on it signals pid 0 (our own process group), taking the whole service down.
export function stopProcess(child: ChildProcess | null, { group = false } = {}) {
	if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	if (!group) {
		child.kill();
		return;
	}
	try {
		// A negative pid targets the child's own group, so a recorder behind `sh -c` dies too and frees the mic.
		process.kill(-child.pid);
	} catch {
		// Already exited.
	}
}
