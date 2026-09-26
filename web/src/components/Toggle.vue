<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
defineProps<{ label?: string }>();
</script>

<template>
	<button
		type="button"
		role="switch"
		:aria-checked="model"
		:aria-label="label"
		class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition"
		:class="model ? 'bg-amber-300' : 'bg-slate-700'"
		@click="model = !model"
	>
		<span class="inline-block size-5 rounded-full bg-white shadow transition" :class="model ? 'translate-x-5.5' : 'translate-x-0.5'" />
	</button>
</template>
