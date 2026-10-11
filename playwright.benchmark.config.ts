import './testing/browser/colors.js'
import { defineConfig, devices } from '@playwright/test'
import config from './playwright.config.js'
import { designs, type BrowserOptions } from './testing/browser/fixtures.js'

export default defineConfig<BrowserOptions>({
  ...config,
  testMatch: '**/*.benchmark.ts',
  testIgnore: [],
  timeout: 180_000,
  // All three designs run serially. The complete stress suite exceeds ten minutes
  // on shared CI runners; individual tests and operation budgets remain unchanged.
  globalTimeout: 20 * 60_000,
  // Large forms may take longer to mount on shared CI runners. This only bounds
  // startup; operation assertions and edit latency budgets remain unchanged.
  use: { ...config.use, formReadyTimeoutMs: 30_000 },
  workers: 1,
  fullyParallel: false,
  outputDir: 'test-results/benchmarks',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/benchmarks', open: 'never' }],
    ['junit', { outputFile: 'test-results/benchmarks.xml' }],
  ],
  projects: designs.map((design) => ({
    name: `${design}-performance`,
    use: { ...devices['Desktop Chrome'], design },
  })),
})
