import { defineConfig } from 'vite';
import path from 'node:path';

/**
 * Bundles the shipped engine into a plain script the evaluation page can load,
 * so a batch runs the real pipeline (prompt building, style notes, enforcement,
 * fidelity, and the retry) rather than a hand-rolled copy of it that drifts.
 *
 *   npx vite build --config eval/vite.config.ts
 */
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'engine-entry.ts'),
      name: 'SecondDraft',
      formats: ['iife'],
      fileName: () => 'engine.js',
    },
    outDir: path.resolve(__dirname, '../tests-e2e/fixtures'),
    emptyOutDir: false,
    minify: false,
    target: 'chrome138',
  },
});
