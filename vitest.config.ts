import { defineConfig } from 'vitest/config';
import path from 'path';

// Dedicated Vitest config so unit tests are discovered across the whole `src/`
// tree (the Vite build config pins root to `src/renderer`, which hid main-process
// tests like src/main/platform/*.test.ts).
export default defineConfig({
  test: {
    root: __dirname,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@bridge': path.resolve(__dirname, 'src/bridge'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
