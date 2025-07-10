import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: [
      'src/bots/index.ts',
      'src/orchestrator/index.ts',
    ],
    format: ['esm'],
    clean: true,
    sourcemap: true,
    minify: true,
    target: 'node18',
    platform: 'node',
    outDir: 'dist',
  },
  // If you do ship the SDK as a browser lib, keep this block:
  // {
  //   entry: ['src/browser.ts'],
  //   format: ['iife'],
  //   globalName: 'HyperliquidSDK',
  //   platform: 'browser',
  //   target: 'es2020',
  //   minify: true,
  //   sourcemap: true,
  //   clean: false,
  //   outDir: 'dist',
  // },
]);
