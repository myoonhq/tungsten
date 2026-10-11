import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./framework/react/src/test/setup.ts'],
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: process.env.CI
      ? { junit: `test-results/${process.env.TUNGSTEN_TEST_STAGE ?? 'unit'}.xml` }
      : undefined,
    testTimeout: 10_000,
    hookTimeout: 30_000,
    include: ['framework/react/src/**/*.test.tsx', 'api/src/**/*.test.ts'],
  },
})
