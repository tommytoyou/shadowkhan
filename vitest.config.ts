import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Tests run straight from game/*.ts source with no build step. The alias
// below is a belt-and-braces guard: even if a test or helper ever imports
// the package by its workspace name ('@shadowkhan/game') instead of a
// relative path, resolution still lands on game/index.ts (source), never on
// game/dist (compiled output) — the workspace package.json's "main" field
// would otherwise point there.
export default defineConfig({
  test: {
    include: ['game/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@shadowkhan/game': path.resolve(__dirname, 'game/index.ts'),
    },
  },
});
