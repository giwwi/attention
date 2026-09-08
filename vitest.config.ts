import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup-vault-compat.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: { reporter: ['text', 'html'] },
  },
});
