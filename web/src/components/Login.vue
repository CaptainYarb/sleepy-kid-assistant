<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, session } from '../api';

const pin = ref('');
const error = ref('');
const busy = ref(false);
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

const dots = computed(() => '•'.repeat(pin.value.length));

function press(key: string) {
	error.value = '';
	if (key === '⌫') {
		pin.value = pin.value.slice(0, -1);
	} else if (key && pin.value.length < 10) {
		pin.value += key;
	}
}

async function submit() {
	if (!pin.value || busy.value) {
		return;
	}
	busy.value = true;
	try {
		await api('/login', { body: { pin: pin.value } });
		session.authenticated = true;
	} catch (err) {
		error.value = (err as Error).message;
		pin.value = '';
	} finally {
		busy.value = false;
	}
}

function onKey(event: KeyboardEvent) {
	if (/^\d$/.test(event.key)) {
		press(event.key);
	} else if (event.key === 'Backspace') {
		press('⌫');
	} else if (event.key === 'Enter') {
		void submit();
	}
}
</script>

<template>
	<div class="flex min-h-dvh items-center justify-center p-6" tabindex="0" @keydown="onKey">
		<form class="w-full max-w-xs text-center" @submit.prevent="submit">
			<div class="text-5xl">🌙</div>
			<h1 class="mt-3 text-xl font-bold">Sleepy</h1>
			<p class="mt-1 text-sm text-slate-400">Enter the parent PIN</p>
			<div class="mt-6 flex h-10 items-center justify-center text-3xl tracking-[0.4em] text-amber-300">{{ dots || '·' }}</div>
			<p class="h-5 text-sm text-rose-300" role="alert">{{ error }}</p>
			<div class="mt-4 grid grid-cols-3 gap-3">
				<button
					v-for="key in keys"
					:key="key"
					type="button"
					class="h-16 rounded-2xl text-2xl font-semibold transition active:scale-95"
					:class="key ? 'bg-slate-900 ring-1 ring-white/5 hover:bg-slate-800' : 'invisible'"
					@click="press(key)"
				>
					{{ key }}
				</button>
			</div>
			<button type="submit" class="btn-primary mt-5 w-full py-3.5" :disabled="!pin || busy">Unlock</button>
		</form>
	</div>
</template>
