<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { PublicConfig } from '../../../server/shared';
import { api, attempt, getConfig, notify, session } from '../api';
import Toggle from '../components/Toggle.vue';

const config = ref<PublicConfig | null>(null);
const darkHoursOn = ref(false);
const darkHours = ref({ start: '20:00', end: '07:00' });
const pin = ref({ current: '', next: '' });

onMounted(async () => {
	config.value = await getConfig();
	darkHoursOn.value = Boolean(config.value.lcd.darkHours);
	darkHours.value = config.value.lcd.darkHours ?? darkHours.value;
});

async function save(section: Partial<PublicConfig>) {
	const saved = await attempt(() => api<PublicConfig>('/config', { method: 'PUT', body: section }), 'Settings saved');
	if (saved) {
		config.value = saved;
	}
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

		<form class="card space-y-3" @submit.prevent="save({ volume: config.volume })">
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
