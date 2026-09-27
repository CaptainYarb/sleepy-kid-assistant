<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { CommandType, PublicConfig } from '../../../server/shared';
import { api, attempt, getConfig, notify, session } from '../api';
import Toggle from '../components/Toggle.vue';

const config = ref<PublicConfig | null>(null);
const darkHoursOn = ref(false);
const darkHours = ref({ start: '20:00', end: '07:00' });
const quietOn = ref(false);
const quietHours = ref({ start: '20:00', end: '07:00', max: 30 });
const lockHoursOn = ref(false);
const lockHours = ref({ start: '19:00', end: '07:00' });
const pin = ref({ current: '', next: '' });
// Typed as a Record so a new server command type fails the build until it gets a label here.
const commandLabels: Record<CommandType, string> = {
	'play-folder': 'Play a folder',
	'play-track': 'Play a story',
	'play-radio': 'Play music (radio)',
	'stop': 'Stop',
	'pause': 'Pause',
	'resume': 'Resume',
	'next': 'Next track',
	'louder': 'Louder',
	'quieter': 'Quieter',
	'max-volume': 'Volume to max',
	'time': 'What time is it',
	'day': 'What day is it',
	'tomorrow': 'What day is it tomorrow',
	'weather': 'Weather',
};

function saveLockHours() {
	void save({ voice: { ...config.value!.voice, hours: lockHoursOn.value ? lockHours.value : null } });
}

function toggleCommand(type: CommandType, on: boolean) {
	const allowed = config.value!.voice.allowed.filter((t) => t !== type);
	void save({ voice: { ...config.value!.voice, allowed: on ? [...allowed, type] : allowed } });
}
const placeQuery = ref('');
const places = ref<Pick<PublicConfig['weather'], 'place' | 'latitude' | 'longitude'>[]>([]);
const weatherPreview = ref('');

async function searchPlaces() {
	if (placeQuery.value.trim()) {
		places.value = await attempt(() => api<typeof places.value>(`/weather/places?q=${encodeURIComponent(placeQuery.value)}`)) ?? [];
	}
}

async function choosePlace(place: typeof places.value[number]) {
	await save({ weather: { ...config.value!.weather, ...place } });
	places.value = [];
	placeQuery.value = '';
	weatherPreview.value = '';
}

async function previewWeather() {
	const result = await attempt(() => api<{ text: string }>('/weather'));
	weatherPreview.value = result?.text ?? '';
}

onMounted(async () => {
	config.value = await getConfig();
	darkHoursOn.value = Boolean(config.value.lcd.darkHours);
	darkHours.value = config.value.lcd.darkHours ?? darkHours.value;
	quietOn.value = Boolean(config.value.volume.quietHours);
	quietHours.value = config.value.volume.quietHours ?? quietHours.value;
	lockHoursOn.value = Boolean(config.value.voice.hours);
	lockHours.value = config.value.voice.hours ?? lockHours.value;
});

async function save(section: Partial<PublicConfig>) {
	const saved = await attempt(() => api<PublicConfig>('/config', { method: 'PUT', body: section }), 'Settings saved');
	if (saved) {
		config.value = saved;
	}
}

function saveVolume() {
	void save({ volume: { ...config.value!.volume, quietHours: quietOn.value ? quietHours.value : null } });
}

function saveLcd() {
	void save({ lcd: { ...config.value!.lcd, darkHours: darkHoursOn.value ? darkHours.value : null } });
}

async function changePin() {
	const ok = await attempt(() => api('/pin', { method: 'PUT', body: pin.value }), 'PIN changed. Other devices are signed out.');
	if (ok) {
		pin.value = { current: '', next: '' };
	}
}

async function logout() {
	await api('/logout', { method: 'POST' });
	session.authenticated = false;
	notify('Signed out');
}
</script>

<template>
	<div v-if="config" class="space-y-4">
		<h1 class="text-xl font-bold">Settings</h1>

		<form class="card space-y-3" @submit.prevent="save({ wakePhrase: config.wakePhrase })">
			<h2 class="label">Wake phrase</h2>
			<input v-model="config.wakePhrase" class="input" aria-label="Wake phrase" required>
			<p class="text-xs text-slate-500">Two or three easy words work best, like "hey buddy" or "okay moon".</p>
			<div class="flex justify-end"><button class="btn-primary">Save</button></div>
		</form>

		<section class="card space-y-3">
			<h2 class="label">Voice commands</h2>
			<label class="flex items-center justify-between gap-3 text-sm">
				Only allow selected commands
				<Toggle
					:model-value="config.voice.restricted"
					label="Only allow selected commands"
					@update:model-value="save({ voice: { ...config.voice, restricted: $event } })"
				/>
			</label>
			<template v-if="config.voice.restricted">
				<label class="flex items-center justify-between gap-3 text-sm">
					Only at certain times
					<Toggle v-model="lockHoursOn" label="Only at certain times" @update:model-value="saveLockHours" />
				</label>
				<div v-if="lockHoursOn" class="grid grid-cols-2 gap-3">
					<label class="text-sm">
						<span class="mb-1 block text-slate-400">From</span>
						<input v-model="lockHours.start" type="time" class="input" @change="saveLockHours">
					</label>
					<label class="text-sm">
						<span class="mb-1 block text-slate-400">Until</span>
						<input v-model="lockHours.end" type="time" class="input" @change="saveLockHours">
					</label>
				</div>
				<p class="text-xs text-slate-500">
					{{ lockHoursOn ? `Outside ${lockHours.start}-${lockHours.end} every command works.` : 'The lockdown applies all day.' }}
				</p>
			</template>
			<div v-if="config.voice.restricted" class="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
				<label v-for="(label, type) in commandLabels" :key="type" class="flex items-center gap-2.5 text-sm">
					<input
						type="checkbox"
						class="size-4 accent-amber-300"
						:checked="config.voice.allowed.includes(type)"
						@change="toggleCommand(type, ($event.target as HTMLInputElement).checked)"
					>
					{{ label }}
				</label>
			</div>
			<p class="text-xs text-slate-500">Blocked commands play the error chime and show as "blocked" on the Voice page. The portal and schedules are not affected.</p>
		</section>

		<form class="card space-y-3" @submit.prevent="saveVolume">
			<h2 class="label">Volume</h2>
			<div class="grid grid-cols-3 gap-3">
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">Start at</span>
					<input v-model.number="config.volume.default" type="number" min="0" max="100" class="input">
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">Maximum</span>
					<input v-model.number="config.volume.max" type="number" min="1" max="100" class="input">
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">Step</span>
					<input v-model.number="config.volume.step" type="number" min="1" max="50" class="input">
				</label>
			</div>
			<p class="text-xs text-slate-500">The maximum applies to voice, schedules and this portal, so little ears stay safe.</p>
			<label class="flex items-center justify-between gap-3 text-sm">
				Lower the maximum at night
				<Toggle v-model="quietOn" label="Lower the maximum at night" />
			</label>
			<div v-if="quietOn" class="grid grid-cols-3 gap-3">
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">From</span>
					<input v-model="quietHours.start" type="time" class="input">
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">Until</span>
					<input v-model="quietHours.end" type="time" class="input">
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">Night max</span>
					<input v-model.number="quietHours.max" type="number" min="0" max="100" class="input">
				</label>
			</div>
			<p v-if="quietOn" class="text-xs text-slate-500">If it is louder than the night max when the time starts, it is turned down quietly.</p>
			<div class="flex justify-end"><button class="btn-primary">Save</button></div>
		</form>

		<form class="card space-y-4" @submit.prevent="saveLcd">
			<h2 class="label">LCD screen</h2>
			<label class="flex items-center justify-between gap-3 text-sm">
				Screen enabled
				<Toggle v-model="config.lcd.enabled" label="Screen enabled" />
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">Backlight off after (sec)</span>
					<input v-model.number="config.lcd.backlightTimeoutSec" type="number" min="0" max="3600" class="input">
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">I2C address</span>
					<input v-model="config.lcd.address" class="input" placeholder="0x27">
				</label>
			</div>
			<label class="flex items-center justify-between gap-3 text-sm">
				Keep backlight off at night
				<Toggle v-model="darkHoursOn" label="Keep backlight off at night" />
			</label>
			<div v-if="darkHoursOn" class="grid grid-cols-2 gap-3">
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">From</span>
					<input v-model="darkHours.start" type="time" class="input">
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-slate-400">Until</span>
					<input v-model="darkHours.end" type="time" class="input">
				</label>
			</div>
			<p class="text-xs text-slate-500">An I2C address change applies after the service restarts.</p>
			<div class="flex justify-end"><button class="btn-primary">Save</button></div>
		</form>

		<section class="card space-y-3">
			<h2 class="label">Weather</h2>
			<div class="flex items-center justify-between gap-3 text-sm">
				<span :class="config.weather.place ? '' : 'text-slate-400'">{{ config.weather.place || 'No city picked yet' }}</span>
				<select
					:value="config.weather.units"
					class="input w-auto py-1.5"
					aria-label="Temperature units"
					@change="save({ weather: { ...config.weather, units: ($event.target as HTMLSelectElement).value as PublicConfig['weather']['units'] } })"
				>
					<option value="fahrenheit">°F</option>
					<option value="celsius">°C</option>
				</select>
			</div>
			<form class="flex gap-2" @submit.prevent="searchPlaces">
				<input v-model="placeQuery" class="input" placeholder="Search for your city" aria-label="Search for your city">
				<button class="btn-ghost shrink-0">Search</button>
			</form>
			<ul v-if="places.length" class="space-y-1">
				<li v-for="place in places" :key="`${place.latitude},${place.longitude}`">
					<button type="button" class="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5" @click="choosePlace(place)">{{ place.place }}</button>
				</li>
			</ul>
			<div v-if="config.weather.place" class="flex items-center gap-3">
				<button type="button" class="btn-ghost shrink-0" @click="previewWeather">Test</button>
				<span class="text-sm text-slate-300">{{ weatherPreview }}</span>
			</div>
			<p class="text-xs text-slate-500">Say "{{ config.wakePhrase }}, what's the weather". Forecasts come from open-meteo.com.</p>
		</section>

		<form class="card space-y-3" @submit.prevent="save({ resume: config.resume })">
			<h2 class="label">Resume after a power cut</h2>
			<label class="flex items-center justify-between gap-3 text-sm">
				Pick up where it left off
				<Toggle
					:model-value="config.resume.enabled"
					label="Pick up where it left off"
					@update:model-value="save({ resume: { ...config.resume, enabled: $event } })"
				/>
			</label>
			<label v-if="config.resume.enabled" class="block text-sm">
				<span class="mb-1 block text-slate-400">Only if power returns within (minutes)</span>
				<input v-model.number="config.resume.withinMinutes" type="number" min="1" max="1440" class="input">
			</label>
			<p class="text-xs text-slate-500">
				Something started by a schedule always resumes while that schedule is still the latest one, however long the outage.
				Resuming is skipped if a stop schedule would have run in the meantime.
			</p>
			<div v-if="config.resume.enabled" class="flex justify-end"><button class="btn-primary">Save</button></div>
		</form>

		<section class="card space-y-3">
			<h2 class="label">Bluetooth</h2>
			<label class="flex items-center justify-between gap-3 text-sm">
				Bluetooth radio
				<Toggle
					:model-value="config.bluetooth.enabled"
					label="Bluetooth radio"
					@update:model-value="save({ bluetooth: { enabled: $event } })"
				/>
			</label>
			<p class="text-xs text-slate-500">Off saves power. Bluetooth speaker mode is coming later and will need this turned on.</p>
		</section>

		<form class="card space-y-3" @submit.prevent="save({ audio: config.audio })">
			<h2 class="label">Audio devices (advanced)</h2>
			<label class="block text-sm">
				<span class="mb-1 block text-slate-400">mpv audio device</span>
				<input v-model="config.audio.mpvDevice" class="input font-mono text-xs" placeholder="auto">
			</label>
			<label class="block text-sm">
				<span class="mb-1 block text-slate-400">Microphone command (16 kHz mono raw PCM on stdout)</span>
				<input v-model="config.audio.recordCommand" class="input font-mono text-xs">
			</label>
			<p class="text-xs text-slate-500">Run <code>mpv --audio-device=help</code> and <code>arecord -l</code> on the Pi to list devices.</p>
			<div class="flex justify-end"><button class="btn-primary">Save</button></div>
		</form>

		<form class="card space-y-3" @submit.prevent="changePin">
			<h2 class="label">Change PIN</h2>
			<div class="grid grid-cols-2 gap-3">
				<input v-model="pin.current" class="input" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Current PIN" aria-label="Current PIN" required>
				<input v-model="pin.next" class="input" type="password" inputmode="numeric" autocomplete="new-password" placeholder="New PIN (4-10 digits)" aria-label="New PIN" pattern="\d{4,10}" required>
			</div>
			<div class="flex justify-end"><button class="btn-primary">Change PIN</button></div>
		</form>

		<button class="btn-ghost w-full" @click="logout">Sign out</button>
	</div>
</template>
