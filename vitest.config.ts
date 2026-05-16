import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'apps/admin-dashboard'),
    },
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', 'node_modules/**', 'Serenity Video Demo/**'],
  },
})
