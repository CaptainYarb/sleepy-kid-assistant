<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { PublicConfig, Station } from '../../../server/shared';
import { api, attempt, getConfig, live } from '../api';

interface SearchResult {
	name: string;
	url: string;
	country: string;
	codec: string;
	bitrate: number;
	tags: string;
}

const radio = ref<PublicConfig['radio']>({ defaultStation: '', stations: [] });
const draft = ref({ name: '', url: '' });
const query = ref('');
const results = ref<SearchResult[]>([]);
const searching = ref(false);

async function save(next: PublicConfig['radio'], message?: string) {
	const config = await attempt(() => api<PublicConfig>('/config', { method: 'PUT', body: { radio: next } }), message);
	if (config) {
		radio.value = config.radio;
	}
	return Boolean(config);
}

async function add(station: { name: string; url: string }) {
	const added = await save({ ...radio.value, stations: [...radio.value.stations, { id: '', ...station }] }, `Added ${station.name}`);
	if (added) {
		draft.value = { name: '', url: '' };
	}
}

const remove = (station: Station) => save({ ...radio.value, stations: radio.value.stations.filter((s) => s.id !== station.id) }, 'Station removed');
const makeDefault = (station: Station) => save({ ...radio.value, defaultStation: station.id });
const play = (station: Station) => attempt(() => api('/player/play', { body: { stationId: station.id } }));

async function search() {
	if (!query.value.trim()) {
		return;
	}
	searching.value = true;
	results.value = await attempt(() => api<SearchResult[]>(`/radio/search?q=${encodeURIComponent(query.value)}`)) ?? [];
	searching.value = false;
}

onMounted(async () => {
	radio.value = (await getConfig()).radio;
});
</script>

<template>
	<div class="space-y-4">
		<div>
			<h1 class="text-xl font-bold">Radio</h1>
			<p class="text-sm text-slate-400">"Play music" plays the default station (★).</p>
		</div>

		<section class="card space-y-2">
			<p v-if="!radio.stations.length" class="text-sm text-slate-400">No stations yet. Search below or add a stream URL.</p>
			<div v-for="station in radio.stations" :key="station.id" class="flex items-center gap-2 rounded-xl bg-white/[0.03] p-2 pl-3">
				<button
					class="text-lg"
					:class="station.id === radio.defaultStation ? 'text-amber-300' : 'text-slate-600 hover:text-slate-400'"
					:aria-label="`Make ${station.name} the default`"
					@click="makeDefault(station)"
				>
					★
				</button>
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">{{ station.name }}</p>
					<p class="truncate text-xs text-slate-500">{{ station.url }}</p>
				</div>
				<button
					class="btn-ghost px-3 py-1.5"
					:class="live.status?.player.source?.type === 'radio' && live.status.player.source.id === station.id && 'ring-1 ring-amber-300'"
					@click="play(station)"
				>
					▶
				</button>
				<button class="btn-ghost px-3 py-1.5 text-rose-300" :aria-label="`Remove ${station.name}`" @click="remove(station)">✕</button>
			</div>
		</section>

		<section class="card">
			<h2 class="label">Find a station</h2>
			<form class="flex gap-2" @submit.prevent="search">
				<input v-model="query" class="input" placeholder="e.g. lullaby, classical, kids" aria-label="Search stations">
				<button class="btn-primary shrink-0" :disabled="searching">{{ searching ? '…' : 'Search' }}</button>
			</form>
			<div v-if="results.length" class="mt-3 max-h-96 space-y-1 overflow-y-auto">
				<div v-for="result in results" :key="result.url" class="flex items-center gap-2 rounded-xl p-2 hover:bg-white/5">
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{{ result.name }}</p>
						<p class="truncate text-xs text-slate-500">{{ [result.country, result.codec, result.bitrate ? `${result.bitrate}k` : '', result.tags].filter(Boolean).join(' · ') }}</p>
					</div>
					<button class="btn-ghost shrink-0 px-3 py-1.5" @click="add(result)">+ Add</button>
				</div>
			</div>
			<p class="mt-2 text-xs text-slate-500">Search results come from radio-browser.info.</p>
		</section>

		<form class="card space-y-3" @submit.prevent="add(draft)">
			<h2 class="label">Add by URL</h2>
			<input v-model="draft.name" class="input" placeholder="Station name" aria-label="Station name" required>
			<input v-model="draft.url" class="input" type="url" placeholder="https://stream.example.com/live.mp3" aria-label="Stream URL" required>
			<div class="flex justify-end">
				<button class="btn-primary">Add station</button>
			</div>
		</form>
	</div>
</template>
