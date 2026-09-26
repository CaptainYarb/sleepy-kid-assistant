import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	root: 'web',
	plugins: [vue(), tailwindcss()],
	build: {
		outDir: '../dist/web',
		emptyOutDir: true,
	},
	server: {
		host: true,
		proxy: {
			'/api': 'http://localhost:8080',
		},
	},
});
