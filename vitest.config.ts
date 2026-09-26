import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['server/**/*.test.ts'],
		// Server modules load config on import, so point them at a throwaway data folder.
		env: { DATA_DIR: path.join(os.tmpdir(), 'sleepy-test-data'), MEDIA_DIR: path.join(os.tmpdir(), 'sleepy-test-media') },
	},
});
