import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { DATA_DIR, store } from './config.js';

const COOKIE = 'sleepy_session';
const SESSION_MS = 30 * 24 * 60 * 60_000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

const secretFile = path.join(DATA_DIR, 'secret');
if (!existsSync(secretFile)) {
	writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
}
const secret = readFileSync(secretFile, 'utf8').trim();

let failures = 0;
let lockedUntil = 0;

// The PIN is part of the signature so changing it signs out every other device.
function sign(expires: number) {
	return createHmac('sha256', secret).update(`${expires}:${store.config.pin}`).digest('base64url');
}

function safeEqual(a: string, b: string) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function isAuthenticated(c: Context) {
	const [expires, signature] = (getCookie(c, COOKIE) ?? '').split('.');
	const expiresAt = Number(expires);
	if (!expiresAt || expiresAt < Date.now() || !signature) {
		return false;
	}
	return safeEqual(signature, sign(expiresAt));
}

export function issueSession(c: Context) {
	const expires = Date.now() + SESSION_MS;
	setCookie(c, COOKIE, `${expires}.${sign(expires)}`, {
		httpOnly: true,
		sameSite: 'Lax',
		secure: c.req.header('x-forwarded-proto') === 'https',
		path: '/',
		expires: new Date(expires),
	});
}

export function lockedUntilTime() {
	return lockedUntil > Date.now() ? lockedUntil : null;
}

export function checkPin(pin: string) {
	if (lockedUntilTime()) {
		return false;
	}
	if (safeEqual(pin, store.config.pin)) {
		failures = 0;
		return true;
	}
	failures++;
	// One global lockout rather than per-IP, since every request arrives from cloudflared on localhost.
	if (failures >= MAX_FAILURES) {
		failures = 0;
		lockedUntil = Date.now() + LOCKOUT_MS;
	}
	return false;
}

export function logout(c: Context) {
	deleteCookie(c, COOKIE, { path: '/' });
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
	if (!isAuthenticated(c)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	await next();
};
