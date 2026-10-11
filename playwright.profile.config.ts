import './testing/browser/colors.js'
import { defineConfig } from '@playwright/test'
import config from './playwright.benchmark.config.js'

// Diagnostic timings are separate from the qualification suite and its reports.
export default defineConfig({
  ...config,
  use: { ...config.use, trace: 'off', video: 'off' },
  testMatch: '**/slowdown.profile.ts',
  outputDir: 'test-results/profiling',
  reporter: [['list']],
})
