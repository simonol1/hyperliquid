import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/bots/index.ts'],
    format: ['cjs', 'esm'],
    clean: true,
    sourcemap: true,
    minify: true,
    target: 'node18',
    platform: 'node',
  },
  {
    entry: ['src/browser.ts'],
    format: ['iife'],
    globalName: 'HyperliquidSDK',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    sourcemap: true,
    clean: false,
    outDir: 'dist',
  },
]);