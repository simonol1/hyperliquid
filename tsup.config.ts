import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    trend: 'src/bots/trend-entry.ts',
    breakout: 'src/bots/breakout-entry.ts',
    reversion: 'src/bots/reversion-entry.ts',
    orchestrator: 'src/orchestrator/index.ts',
  },
  outDir: 'dist',
  format: 'esm',
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node18',
  outExtension: () => ({ js: '.mjs' }),
});
