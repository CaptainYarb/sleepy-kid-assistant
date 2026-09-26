import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { runCommand } from './actions.js';
import { buildGrammar, describeCommand, parseCommand, splitWake, type VoiceFolder } from './commands.js';
import { ROOT_DIR, store } from './config.js';
import { events } from './events.js';
import { listFolders } from './library.js';
import * as player from './player.js';
import type { VoiceEntry, VoiceStatus } from './shared.js';

const PY_DIR = path.join(ROOT_DIR, 'py');
const VENV_PYTHON = path.join(PY_DIR, '.venv', 'bin', 'python');
const MODEL_DIR = path.resolve(process.env.VOSK_MODEL ?? path.join(PY_DIR, 'model'));
const COMMAND_WINDOW_MS = 6000;
const LOG_SIZE = 50;

const status: VoiceStatus = {
	enabled: process.env.VOICE !== 'off',
	running: false,
	listening: false,
	problem: null,
	unknownWords: [],
	log: [],
};

let generation = 0;
let children: ChildProcess[] = [];
let currentGrammar = '';
let windowTimer: NodeJS.Timeout | undefined;
let restartDelay = 2000;
let shuttingDown = false;

export function getVoiceStatus(): VoiceStatus {
	return { ...status, log: [...status.log] };
}

function emit() {
	events.emit('voice', getVoiceStatus());
}

function voiceFolders(): VoiceFolder[] {
	return listFolders()
		.filter((f) => f.settings.enabled)
		.map((f) => ({ name: f.name, spokenName: f.settings.spokenName }));
}

function addLog(text: string, result: string) {
	const entry: VoiceEntry = { at: Date.now(), text, result };
	status.log.unshift(entry);
	status.log.length = Math.min(status.log.length, LOG_SIZE);
	emit();
}

function closeWindow() {
	clearTimeout(windowTimer);
	if (!status.listening) {
		return;
	}
	status.listening = false;
	emit();
	player.duck(false).catch(() => {});
}

function openWindow() {
	status.listening = true;
	player.chime('wake');
	player.duck(true).catch(() => {});
	clearTimeout(windowTimer);
	windowTimer = setTimeout(closeWindow, COMMAND_WINDOW_MS);
}

export async function handleText(text: string) {
	const { woke, rest } = splitWake(text, store.config.wakePhrase);
	if (!woke && !rest) {
		return;
	}
	if (woke && !rest) {
		openWindow();
		addLog(text, 'wake');
		return;
	}
	if (!woke && !status.listening) {
		addLog(text, 'ignored (no wake phrase)');
		return;
	}
	closeWindow();
	const command = parseCommand(rest, voiceFolders());
	if (!command) {
		player.chime('error');
		addLog(text, 'not understood');
		return;
	}
	try {
		await runCommand(command);
		addLog(text, describeCommand(command));
	} catch (err) {
		player.chime('error');
		addLog(text, `failed: ${(err as Error).message}`);
	}
}

function stopChildren() {
	generation++;
	for (const child of children) {
		child.kill();
	}
	children = [];
	status.running = false;
}

function setProblem(problem: string | null) {
	status.problem = problem;
	if (problem) {
		console.warn(`[voice] ${problem}`);
	}
	emit();
}

function start() {
	currentGrammar = JSON.stringify(buildGrammar(store.config.wakePhrase, voiceFolders()));
	if (!status.enabled) {
		return;
	}
	if (!existsSync(MODEL_DIR)) {
		setProblem(`Vosk model not found at ${MODEL_DIR}`);
		return;
	}
	const gen = ++generation;
	const python = existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';
	const recorder = spawn('sh', ['-c', store.config.audio.recordCommand], { stdio: ['ignore', 'pipe', 'pipe'] });
	const recognizer = spawn(python, [path.join(PY_DIR, 'listen.py'), MODEL_DIR, currentGrammar], { stdio: ['pipe', 'pipe', 'pipe'] });
	children = [recorder, recognizer];

	recorder.stdout.pipe(recognizer.stdin);
	// The recognizer can exit first, and a write to its closed stdin should not crash the server.
	recognizer.stdin.on('error', () => {});
	recorder.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[mic] ${chunk}`));
	recognizer.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[vosk] ${chunk}`));

	createInterface({ input: recognizer.stdout }).on('line', (line) => {
		let msg: { type: string; text?: string; words?: string[] };
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		if (msg.type === 'ready') {
			status.running = true;
			restartDelay = 2000;
			setProblem(null);
		} else if (msg.type === 'oov') {
			status.unknownWords = msg.words ?? [];
			emit();
		} else if (msg.type === 'text' && msg.text) {
			void handleText(msg.text);
		}
	});

	const onExit = () => {
		if (gen !== generation || shuttingDown) {
			return;
		}
		stopChildren();
		setProblem('Microphone or recognizer stopped, restarting');
		setTimeout(start, restartDelay);
		restartDelay = Math.min(restartDelay * 2, 60_000);
	};
	for (const child of children) {
		child.on('exit', onExit);
		child.on('error', onExit);
	}
}

// Rebuilds the recognizer when folders, spoken names, the wake phrase or the mic command change.
export function refreshVoice(force = false) {
	const grammar = JSON.stringify(buildGrammar(store.config.wakePhrase, voiceFolders()));
	if (!force && grammar === currentGrammar) {
		return;
	}
	stopChildren();
	start();
}

export function startVoice() {
	start();
}

export function stopVoice() {
	shuttingDown = true;
	stopChildren();
}
