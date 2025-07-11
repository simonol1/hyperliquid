import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    bot: 'src/bots/index.ts',
    orchestrator: 'src/orchestrator/index.ts'
  },
  outDir: 'dist',
  format: 'cjs',
  target: 'node18',
  splitting: false,
  sourcemap: true,
  clean: true,
});