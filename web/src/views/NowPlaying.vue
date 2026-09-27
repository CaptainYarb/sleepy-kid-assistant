<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Folder, PublicConfig } from '../../../server/shared';
import { api, attempt, DAY_NAMES, formatTime, getConfig, getFolders, live } from '../api';
import LcdPreview from '../components/LcdPreview.vue';

const status = computed(() => live.status!);
const player = computed(() => status.value.player);
const folders = ref<Folder[]>([]);
const config = ref<PublicConfig | null>(null);
const volume = ref(player.value.volume);

watch(() => player.value.volume, (v) => (volume.value = v));

const playableFolders = computed(() => folders.value.filter((f) => f.settings.enabled && f.trackCount));
const nextLabel = computed(() => {
	const next = status.value.next;
	if (!next) {
		return null;
	}
	const at = new Date(next.at);
	const day = at.toDateString() === new Date().toDateString() ? 'Today' : DAY_NAMES[at.getDay()];
	const what = next.schedule.action === 'stop'
		? 'Stop'
		: next.schedule.folder ?? config.value?.radio.stations.find((s) => s.id === next.schedule.stationId)?.name ?? 'Radio';
	return `${day} ${formatTime(next.schedule.time)} · ${what}`;
});

const statusLabel = computed(() => {
	if (!player.value.available) {
		return 'Player offline';
	}
	return { playing: 'Now playing', paused: 'Paused', stopped: 'Nothing playing' }[player.value.status];
});

onMounted(async () => {
	[folders.value, config.value] = await Promise.all([getFolders(), getConfig()]);
});

const play = (body: { folder?: string; stationId?: string }) => attempt(() => api('/player/play', { body }));
const control = (action: 'stop' | 'pause' | 'resume' | 'next' | 'restart') => attempt(() => api(`/player/${action}`, { method: 'POST' }));
const setVolume = (value: number) => attempt(() => api('/player/volume', { method: 'PUT', body: { volume: value } }));
const step = (direction: 1 | -1) => setVolume(volume.value + direction * (config.value?.volume.step ?? 10));
</script>

<template>
	<div class="space-y-4">
		<div class="flex justify-center py-2">
			<LcdPreview :lcd="status.lcd" />
		</div>

		<section class="card">
			<p class="text-xs font-medium tracking-wide text-slate-400 uppercase">{{ statusLabel }}</p>
			<h2 class="mt-1 truncate text-2xl font-bold">
				{{ player.source?.label ?? 'Quiet time' }}
			</h2>
			<p class="mt-0.5 h-5 truncate text-sm text-slate-400">{{ player.track ?? '' }}</p>

			<div class="mt-5 flex items-center justify-center gap-3">
				<button class="btn-ghost size-14 rounded-full" :disabled="player.status === 'stopped'" aria-label="Stop" @click="control('stop')">
					<svg viewBox="0 0 24 24" class="size-5 fill-current"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
				</button>
				<button
					v-if="player.source?.type !== 'radio'"
					class="btn-ghost size-14 rounded-full"
					:disabled="player.status === 'stopped'"
					aria-label="Restart track"
					@click="control('restart')"
				>
					<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4.5H9" /></svg>
				</button>
				<button
					class="btn-primary size-18 rounded-full"
					:disabled="player.status === 'stopped'"
					:aria-label="player.status === 'playing' ? 'Pause' : 'Resume'"
					@click="control(player.status === 'playing' ? 'pause' : 'resume')"
				>
					<svg v-if="player.status === 'playing'" viewBox="0 0 24 24" class="size-7 fill-current"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
					<svg v-else viewBox="0 0 24 24" class="size-7 fill-current"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
				</button>
				<button class="btn-ghost size-14 rounded-full" :disabled="player.source?.type !== 'folder'" aria-label="Next track" @click="control('next')">
					<svg viewBox="0 0 24 24" class="size-5 fill-current"><path d="M5 6.5v11a1 1 0 0 0 1.5.86L15 13v4.5a1 1 0 0 0 2 0v-11a1 1 0 0 0-2 0V11L6.5 5.64A1 1 0 0 0 5 6.5Z" /></svg>
				</button>
			</div>

			<div class="mt-6 flex items-center gap-3">
				<button class="btn-ghost size-10 shrink-0 rounded-full p-0 text-lg" aria-label="Quieter" @click="step(-1)">−</button>
				<input
					v-model.number="volume"
					type="range"
					min="0"
					:max="player.maxVolume"
					class="h-2 w-full cursor-pointer accent-amber-300"
					aria-label="Volume"
					@change="setVolume(volume)"
				>
				<button class="btn-ghost size-10 shrink-0 rounded-full p-0 text-lg" aria-label="Louder" @click="step(1)">+</button>
				<span class="w-10 text-right text-sm text-slate-400 tabular-nums">{{ volume }}%</span>
			</div>
			<p v-if="config && player.maxVolume < config.volume.max" class="mt-2 text-right text-xs text-amber-300/80">Night limit: {{ player.maxVolume }}%</p>
		</section>

		<section class="card">
			<h3 class="label">Play something</h3>
			<div v-if="playableFolders.length || config?.radio.stations.length" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
				<button
					v-for="folder in playableFolders"
					:key="folder.name"
					class="btn-ghost justify-start truncate py-3"
					:class="player.source?.type === 'folder' && player.source.name === folder.name && 'ring-1 ring-amber-300'"
					@click="play({ folder: folder.name })"
				>
					<span class="truncate">{{ folder.name }}</span>
				</button>
				<button
					v-if="config?.radio.stations.length"
					class="btn-ghost justify-start py-3"
					:class="player.source?.type === 'radio' && 'ring-1 ring-amber-300'"
					@click="play({})"
				>
					📻 Radio
				</button>
			</div>
			<p v-else class="text-sm text-slate-400">No folders yet. Copy MP3 folders into the media folder and they show up here within a minute.</p>
		</section>

		<section class="grid gap-4 sm:grid-cols-2">
			<div class="card">
				<h3 class="label">Next schedule</h3>
				<p class="font-medium">{{ nextLabel ?? 'Nothing scheduled' }}</p>
			</div>
			<div class="card">
				<h3 class="label">Voice</h3>
				<p v-if="!status.voice.enabled" class="text-slate-400">Turned off</p>
				<p v-else-if="status.voice.listening" class="flex items-center gap-2 font-medium text-amber-300">
					<span class="size-2 animate-ping rounded-full bg-amber-300" /> Listening…
				</p>
				<p v-else-if="status.voice.running" class="font-medium">Ready for "{{ config?.wakePhrase }}"</p>
				<p v-else class="text-sm text-rose-300">{{ status.voice.problem ?? 'Starting…' }}</p>
			</div>
		</section>
	</div>
</template>
