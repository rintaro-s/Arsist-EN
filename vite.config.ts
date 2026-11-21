import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      // 2 つ目の入口: ヘッドレスのプレビュー シミュレータ (scripts/sim/preview.mjs が開く。doc/22-simulation.md)
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html'),
        sim: path.resolve(__dirname, 'src/renderer/sim/sim.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@editor': path.resolve(__dirname, 'src/renderer/editor'),
      '@components': path.resolve(__dirname, 'src/renderer/components'),
      '@bridge': path.resolve(__dirname, 'src/bridge'),
      '@adapters': path.resolve(__dirname, 'src/adapters'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
