<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, attempt, getConfig, live } from '../api';

const voice = computed(() => live.status!.voice);
const wakePhrase = ref('');
const phrase = ref('');

async function simulate() {
	if (!phrase.value.trim()) {
		return;
	}
	await attempt(() => api('/voice/simulate', { body: { text: phrase.value } }));
	phrase.value = '';
}

function time(at: number) {
	return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function resultClass(result: string) {
	if (result === 'not understood' || result.startsWith('failed') || result.startsWith('blocked')) {
		return 'text-rose-300';
	}
	return 'text-emerald-300';
}

onMounted(async () => {
	wakePhrase.value = (await getConfig()).wakePhrase;
});
</script>

<template>
	<div class="space-y-4">
		<div>
			<h1 class="text-xl font-bold">Voice</h1>
			<p class="text-sm text-slate-400">Wake phrase requests and what it did about them. Speech without the wake phrase is never logged.</p>
		</div>

		<section class="card space-y-2 text-sm">
			<div class="flex justify-between">
				<span class="text-slate-400">Status</span>
				<span v-if="!voice.enabled">Turned off (VOICE=off)</span>
				<span v-else-if="voice.running" class="text-emerald-300">Listening for "{{ wakePhrase }}"</span>
				<span v-else class="text-rose-300">{{ voice.problem ?? 'Starting…' }}</span>
			</div>
			<p v-if="voice.unknownWords.length" class="text-amber-300">
				Words the model does not know (they are ignored): {{ voice.unknownWords.join(', ') }}
			</p>
		</section>

		<form class="card" @submit.prevent="simulate">
			<label class="label" for="simulate">Try a phrase</label>
			<div class="flex gap-2">
				<input id="simulate" v-model="phrase" class="input" :placeholder="`${wakePhrase} play stories`" autocomplete="off">
				<button class="btn-primary shrink-0">Send</button>
			</div>
			<p class="mt-2 text-xs text-slate-500">
				Runs exactly as if it was heard, so include the wake phrase. Commands: play &lt;folder&gt;, play &lt;story&gt; [in &lt;folder&gt;], play music, stop, pause, resume, next, louder, quieter, volume to max, what time is it, what day is it, what day is it tomorrow, what's the weather.
			</p>
		</form>

		<section class="card">
			<h2 class="label">Recent</h2>
			<p v-if="!voice.log.length" class="text-sm text-slate-400">Nothing heard yet.</p>
			<ul class="divide-y divide-white/5">
				<li v-for="entry in voice.log" :key="entry.at" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
					<span class="w-20 shrink-0 text-xs text-slate-500 tabular-nums">{{ time(entry.at) }}</span>
					<span class="min-w-0 flex-1 truncate">"{{ entry.text }}"</span>
					<span class="shrink-0 text-xs" :class="resultClass(entry.result)">{{ entry.result }}</span>
					<span v-if="entry.reply" class="basis-full pl-23 text-xs text-slate-400">"{{ entry.reply }}"</span>
				</li>
			</ul>
		</section>
	</div>
</template>
