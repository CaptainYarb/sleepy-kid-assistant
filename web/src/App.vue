<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, connectLive, disconnectLive, live, session, toast } from './api';
import Icon from './components/Icon.vue';
import Login from './components/Login.vue';
import { navItems } from './router';

const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

watch(() => toast.id, () => {
	toastVisible.value = true;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (toastVisible.value = false), 3500);
});

watch(() => session.authenticated, (authenticated) => {
	if (authenticated) {
		connectLive();
	} else {
		disconnectLive();
	}
});

onMounted(async () => {
	try {
		const result = await api<{ authenticated: boolean }>('/session');
		session.authenticated = result.authenticated;
	} finally {
		session.checked = true;
	}
});
</script>

<template>
	<div v-if="!session.checked" class="flex min-h-dvh items-center justify-center text-slate-500">Loading…</div>
	<Login v-else-if="!session.authenticated" />
	<div v-else class="mx-auto flex min-h-dvh max-w-3xl flex-col">
		<header class="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2 sm:px-6">
			<div class="flex items-center gap-2 text-lg font-bold">
				<span>🌙</span> Sleepy
			</div>
			<span class="flex items-center gap-1.5 text-xs text-slate-400">
				<span class="size-2 rounded-full" :class="live.connected ? 'bg-emerald-400' : 'bg-rose-400'" />
				{{ live.connected ? 'Live' : 'Reconnecting' }}
			</span>
		</header>

		<nav class="sticky top-0 z-10 hidden gap-1 bg-slate-950/90 px-6 py-2 backdrop-blur sm:flex">
			<RouterLink
				v-for="item in navItems"
				:key="item.path"
				:to="item.path"
				class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:text-slate-100"
				active-class="!bg-white/10 !text-amber-300"
				exact-active-class="!bg-white/10 !text-amber-300"
			>
				<Icon :path="item.icon" class="size-4" />
				{{ item.name }}
			</RouterLink>
		</nav>

		<main class="flex-1 px-4 pt-2 pb-28 sm:px-6 sm:pb-10">
			<RouterView v-if="live.status" />
			<div v-else class="py-20 text-center text-slate-500">Connecting…</div>
		</main>

		<nav class="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-white/5 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
			<RouterLink
				v-for="item in navItems"
				:key="item.path"
				:to="item.path"
				class="flex flex-col items-center gap-1 py-2.5 text-[0.65rem] font-medium text-slate-500"
				exact-active-class="!text-amber-300"
			>
				<Icon :path="item.icon" class="size-6" />
				{{ item.name }}
			</RouterLink>
		</nav>

		<Transition
			enter-from-class="translate-y-4 opacity-0"
			leave-to-class="translate-y-4 opacity-0"
			enter-active-class="transition"
			leave-active-class="transition"
		>
			<div
				v-if="toastVisible"
				role="status"
				class="fixed inset-x-4 bottom-24 z-20 mx-auto max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-xl sm:bottom-6"
				:class="toast.kind === 'error' ? 'bg-rose-500 text-white' : 'bg-emerald-400 text-slate-950'"
			>
				{{ toast.message }}
			</div>
		</Transition>
	</div>
</template>
