import { reactive } from 'vue';
import type { Folder, PublicConfig, Status } from '../../server/shared';

export const session = reactive({ checked: false, authenticated: false });
export const live = reactive<{ status: Status | null; connected: boolean }>({ status: null, connected: false });
export const toast = reactive<{ message: string; kind: 'ok' | 'error'; id: number }>({ message: '', kind: 'ok', id: 0 });

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
	const res = await fetch(`/api${path}`, {
		method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
		headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const data = await res.json().catch(() => ({}));
	if (res.status === 401 && path !== '/login') {
		session.authenticated = false;
	}
	if (!res.ok) {
		throw new Error(data.error ?? res.statusText);
	}
	return data as T;
}

export function notify(message: string, kind: 'ok' | 'error' = 'ok') {
	toast.message = message;
	toast.kind = kind;
	toast.id++;
}

// Wraps a portal action so failures show a toast instead of being silently swallowed.
export async function attempt<T>(action: () => Promise<T>, success?: string): Promise<T | undefined> {
	try {
		const result = await action();
		if (success) {
			notify(success);
		}
		return result;
	} catch (err) {
		notify((err as Error).message, 'error');
		return undefined;
	}
}

let source: EventSource | null = null;

export async function refreshStatus() {
	live.status = await api<Status>('/status');
}

export function connectLive() {
	source?.close();
	source = new EventSource('/api/events');
	source.onopen = () => {
		live.connected = true;
		// Catch up on anything missed while the connection was down.
		void refreshStatus();
	};
	source.onerror = () => {
		live.connected = false;
	};
	for (const key of ['player', 'voice', 'lcd'] as const) {
		source.addEventListener(key, (event) => {
			if (live.status) {
				live.status[key] = JSON.parse((event as MessageEvent).data);
			}
		});
	}
}

export function disconnectLive() {
	source?.close();
	source = null;
	live.connected = false;
}

export const getFolders = () => api<Folder[]>('/library');
export const getConfig = () => api<PublicConfig>('/config');

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatTime(time: string) {
	const [h, m] = time.split(':').map(Number);
	return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
