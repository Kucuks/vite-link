import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/bin.ts'],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 75,
        lines: 75,
      },
    },
  },
})
