<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Folder, FolderSettings } from '../../../server/shared';
import { api, attempt, getFolders, live } from '../api';
import Toggle from '../components/Toggle.vue';

const folders = ref<Folder[]>([]);
const drafts = ref<Record<string, string>>({});
const scanning = ref(false);
const unknownWords = computed(() => new Set(live.status?.voice.unknownWords ?? []));

function setFolders(list: Folder[]) {
	folders.value = list;
	drafts.value = Object.fromEntries(list.map((f) => [f.name, f.settings.spokenName]));
}

function unknownIn(spokenName: string) {
	return spokenName.split(' ').filter((word) => unknownWords.value.has(word));
}

async function update(folder: Folder, patch: Partial<FolderSettings>) {
	const list = await attempt(() => api<Folder[]>(`/library/${encodeURIComponent(folder.name)}`, { method: 'PUT', body: patch }));
	if (list) {
		setFolders(list);
	}
}

function saveSpokenName(folder: Folder) {
	if (drafts.value[folder.name] !== folder.settings.spokenName) {
		void update(folder, { spokenName: drafts.value[folder.name] });
	}
}

async function rescan() {
	scanning.value = true;
	const list = await attempt(() => api<Folder[]>('/library/rescan', { method: 'POST' }), 'Library rescanned');
	if (list) {
		setFolders(list);
	}
	scanning.value = false;
}

const play = (folder: Folder) => attempt(() => api('/player/play', { body: { folder: folder.name } }));

onMounted(async () => setFolders(await getFolders()));
</script>

<template>
	<div class="space-y-4">
		<div class="flex items-center justify-between gap-4">
			<div>
				<h1 class="text-xl font-bold">Library</h1>
				<p class="text-sm text-slate-400">Each folder in the media directory becomes a voice command.</p>
			</div>
			<button class="btn-ghost shrink-0" :disabled="scanning" @click="rescan">{{ scanning ? 'Scanning…' : 'Rescan' }}</button>
		</div>

		<div v-if="!folders.length" class="card text-sm text-slate-400">
			No folders found. Copy folders of MP3s into the media directory on the Pi (for example <code class="text-slate-200">~/media/stories</code>). They are picked up automatically within a minute.
		</div>

		<article v-for="folder in folders" :key="folder.name" class="card" :class="!folder.settings.enabled && 'opacity-60'">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 class="truncate text-lg font-semibold">{{ folder.name }}</h2>
					<p class="text-sm text-slate-400">{{ folder.trackCount }} {{ folder.trackCount === 1 ? 'track' : 'tracks' }}</p>
				</div>
				<button class="btn-ghost shrink-0" :disabled="!folder.trackCount" @click="play(folder)">▶ Play</button>
			</div>

			<label class="label mt-4" :for="`spoken-${folder.name}`">Say "play …"</label>
			<input
				:id="`spoken-${folder.name}`"
				v-model="drafts[folder.name]"
				class="input"
				autocomplete="off"
				@blur="saveSpokenName(folder)"
				@keydown.enter="($event.target as HTMLInputElement).blur()"
			>
			<p v-if="unknownIn(folder.settings.spokenName).length" class="mt-1.5 text-xs text-amber-300">
				The voice model does not know "{{ unknownIn(folder.settings.spokenName).join('", "') }}". Try a simpler word or spell numbers out.
			</p>

			<div class="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
				<label class="flex items-center gap-2">
					<Toggle :model-value="folder.settings.enabled" label="Enabled" @update:model-value="update(folder, { enabled: $event })" /> Enabled
				</label>
				<label class="flex items-center gap-2">
					<Toggle :model-value="folder.settings.shuffle" label="Shuffle" @update:model-value="update(folder, { shuffle: $event })" /> Shuffle
				</label>
				<label class="flex items-center gap-2">
					<Toggle :model-value="folder.settings.loop" label="Loop" @update:model-value="update(folder, { loop: $event })" /> Loop
				</label>
			</div>
		</article>
	</div>
</template>
