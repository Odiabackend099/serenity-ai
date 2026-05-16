import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'apps/admin-dashboard'),
    },
  },
  test: {
    include: ['**/*.integration.test.ts'],
    exclude: ['node_modules/**', 'Serenity Video Demo/**'],
    testTimeout: 10_000,
  },
})
