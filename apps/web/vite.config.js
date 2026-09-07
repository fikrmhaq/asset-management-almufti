import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@/…` resolves to `src/…`. shadcn/ui's components assume this alias, and
    // it keeps imports stable when a file moves between directories.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: false,
    restoreMocks: true,
    include: ['src/**/*.test.{js,jsx}'],
    /**
     * Vitest's default is 5s, which these tests genuinely need more than under
     * parallel load.
     *
     * A screen test here renders the real component tree against jsdom and
     * drives it with `userEvent`, which advances real timers per keystroke —
     * individual tests legitimately take one to five seconds on a laptop. With
     * several files running at once the slowest of them cross 5s and fail, and
     * WHICH ones fail changes between runs while every one of them passes in
     * isolation. That is machine load, not a defect in the test.
     *
     * Raised rather than removed: a test that takes 15 seconds IS hung, and
     * that still fails.
     */
    testTimeout: 15000,
  },
});
