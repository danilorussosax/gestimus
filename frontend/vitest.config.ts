import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        // Scope unit = componenti riusabili + lib pure (scoring/tiebreak/rng).
        // Le pages/ sono integration-level → coperte dagli E2E Playwright.
        include: ['src/components/**', 'src/lib/**'],
        exclude: ['**/*.d.ts', 'src/components/ui/**'],
      },
    },
  }),
);
