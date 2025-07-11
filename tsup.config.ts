import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    bot: 'src/bots/index.ts',
    orchestrator: 'src/orchestrator/index.ts',
  },
  outDir: 'dist',
  format: 'esm',
  splitting: false,
  sourcemap: true,
  clean: true,
  outExtension: () => ({ js: '.mjs' }),
});