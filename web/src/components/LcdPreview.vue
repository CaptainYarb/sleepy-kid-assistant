<script setup lang="ts">
import type { LcdState } from '../../../server/shared';

defineProps<{ lcd: LcdState }>();
</script>

<template>
	<div class="inline-block rounded-lg bg-emerald-950 p-2 ring-4 ring-slate-800" aria-label="LCD preview">
		<div
			class="rounded px-2 py-1.5 font-lcd text-base leading-tight font-bold transition-colors sm:text-lg"
			:class="lcd.backlight ? 'bg-sky-500 text-white shadow-[0_0_20px] shadow-sky-500/40' : 'bg-sky-950 text-sky-700'"
		>
			<div v-for="(line, i) in lcd.lines" :key="i" class="whitespace-pre">{{ line.padEnd(16) }}</div>
		</div>
	</div>
</template>
