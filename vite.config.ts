import { defineConfig } from 'vite';

// Capacitor（file:// / https://localhost）と GitHub Pages（/coin-pusher/）の
// 両方で動くよう、すべて相対パスで出力する。
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 6000,
  },
  server: {
    host: true,
  },
});
