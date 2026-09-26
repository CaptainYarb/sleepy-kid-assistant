<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Folder, Schedule, Station } from '../../../server/shared';
import { api, attempt, DAY_NAMES, formatTime, getConfig, getFolders, refreshStatus } from '../api';
import Toggle from '../components/Toggle.vue';

const schedules = ref<Schedule[]>([]);
const folders = ref<Folder[]>([]);
const stations = ref<Station[]>([]);
const editing = ref<Schedule | null>(null);
const confirmDelete = ref<string | null>(null);

const presets = [
	{ label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
	{ label: 'School nights', days: [0, 1, 2, 3, 4] },
	{ label: 'Weekdays', days: [1, 2, 3, 4, 5] },
	{ label: 'Weekend', days: [0, 6] },
];

const sorted = computed(() => [...schedules.value].sort((a, b) => a.time.localeCompare(b.time)));

// Encodes folder vs station into one select value so a single dropdown can offer both.
const target = computed({
	get: () => {
		if (editing.value?.folder) {
			return `folder:${editing.value.folder}`;
		}
		if (editing.value?.stationId) {
			return `station:${editing.value.stationId}`;
		}
		return '';
	},
	set: (value: string) => {
		if (!editing.value) {
			return;
		}
		const [kind, ...rest] = value.split(':');
		editing.value.folder = kind === 'folder' ? rest.join(':') : undefined;
		editing.value.stationId = kind === 'station' ? rest.join(':') : undefined;
	},
});

function describe(schedule: Schedule) {
	if (schedule.action === 'stop') {
		return 'Stop playing';
	}
	if (schedule.folder) {
		return `Play ${schedule.folder}`;
	}
	return `Play ${stations.value.find((s) => s.id === schedule.stationId)?.name ?? 'radio'}`;
}

function describeDays(days: number[]) {
	const preset = presets.find((p) => p.days.length === days.length && p.days.every((d) => days.includes(d)));
	return preset?.label ?? days.map((d) => DAY_NAMES[d]).join(', ');
}

function startNew() {
	editing.value = { id: '', enabled: true, time: '19:30', days: [0, 1, 2, 3, 4], action: 'play', folder: folders.value[0]?.name };
}

function toggleDay(day: number) {
	const days = editing.value!.days;
	editing.value!.days = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
}

async function save(list: Schedule[], message?: string) {
	const saved = await attempt(() => api<Schedule[]>('/schedules', { method: 'PUT', body: list }), message);
	if (saved) {
		schedules.value = saved;
		editing.value = null;
		confirmDelete.value = null;
		void refreshStatus();
	}
}

function submit() {
	const draft = editing.value!;
	const others = schedules.value.filter((s) => s.id !== draft.id);
	void save([...others, draft], 'Schedule saved');
}

onMounted(async () => {
	const [list, folderList, config] = await Promise.all([api<Schedule[]>('/schedules'), getFolders(), getConfig()]);
	schedules.value = list;
	folders.value = folderList;
	stations.value = config.radio.stations;
});
</script>

<template>
	<div class="space-y-4">
		<div class="flex items-center justify-between gap-4">
			<div>
				<h1 class="text-xl font-bold">Schedules</h1>
				<p class="text-sm text-slate-400">Start or stop audio at set times.</p>
			</div>
			<button v-if="!editing" class="btn-primary shrink-0" @click="startNew">+ Add</button>
		</div>

		<form v-if="editing" class="card space-y-4 ring-amber-300/40" @submit.prevent="submit">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="label" for="schedule-time">Time</label>
					<input id="schedule-time" v-model="editing.time" type="time" class="input" required>
				</div>
				<div>
					<label class="label" for="schedule-action">Action</label>
					<select id="schedule-action" v-model="editing.action" class="input">
						<option value="play">Play</option>
						<option value="stop">Stop</option>
					</select>
				</div>
			</div>

			<div v-if="editing.action === 'play'">
				<label class="label" for="schedule-target">What to play</label>
				<select id="schedule-target" v-model="target" class="input" required>
					<option value="" disabled>Choose…</option>
					<optgroup label="Folders">
						<option v-for="folder in folders" :key="folder.name" :value="`folder:${folder.name}`">{{ folder.name }}</option>
					</optgroup>
					<optgroup v-if="stations.length" label="Radio">
						<option v-for="station in stations" :key="station.id" :value="`station:${station.id}`">{{ station.name }}</option>
					</optgroup>
				</select>
			</div>

			<div>
				<span class="label">Days</span>
				<div class="flex flex-wrap gap-1.5">
					<button
						v-for="(name, day) in DAY_NAMES"
						:key="name"
						type="button"
						class="chip w-11"
						:class="editing.days.includes(day) ? 'bg-amber-300 text-slate-950' : 'bg-white/5 text-slate-300'"
						@click="toggleDay(day)"
					>
						{{ name }}
					</button>
				</div>
				<div class="mt-2 flex flex-wrap gap-1.5">
					<button v-for="preset in presets" :key="preset.label" type="button" class="chip bg-white/5 text-slate-400 hover:text-slate-200" @click="editing.days = [...preset.days]">
						{{ preset.label }}
					</button>
				</div>
			</div>

			<div class="flex justify-end gap-2">
				<button type="button" class="btn-ghost" @click="editing = null">Cancel</button>
				<button type="submit" class="btn-primary">Save</button>
			</div>
		</form>

		<p v-if="!schedules.length && !editing" class="card text-sm text-slate-400">No schedules yet. Add one to start bedtime sounds automatically.</p>

		<article v-for="schedule in sorted" :key="schedule.id" class="card flex items-center gap-4" :class="!schedule.enabled && 'opacity-50'">
			<div class="min-w-0 flex-1">
				<p class="text-2xl font-bold tabular-nums">{{ formatTime(schedule.time) }}</p>
				<p class="truncate text-sm text-slate-300">{{ describe(schedule) }}</p>
				<p class="text-xs text-slate-500">{{ describeDays(schedule.days) }}</p>
			</div>
			<div class="flex shrink-0 flex-col items-end gap-3">
				<Toggle
					:model-value="schedule.enabled"
					label="Enabled"
					@update:model-value="save(schedules.map((s) => (s.id === schedule.id ? { ...s, enabled: $event } : s)))"
				/>
				<div v-if="confirmDelete === schedule.id" class="flex gap-1.5">
					<button class="btn-ghost px-3 py-1.5" @click="confirmDelete = null">Keep</button>
					<button class="btn-danger px-3 py-1.5" @click="save(schedules.filter((s) => s.id !== schedule.id), 'Schedule deleted')">Delete</button>
				</div>
				<div v-else class="flex gap-1.5">
					<button class="btn-ghost px-3 py-1.5" @click="editing = { ...schedule, days: [...schedule.days] }">Edit</button>
					<button class="btn-ghost px-3 py-1.5 text-rose-300" @click="confirmDelete = schedule.id">Delete</button>
				</div>
			</div>
		</article>
	</div>
</template>
