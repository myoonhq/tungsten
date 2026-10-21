import './testing/browser/colors.js'
import { defineConfig, devices } from '@playwright/test'
import { designs, type BrowserOptions } from './testing/browser/fixtures.js'
import { firefoxMacOSLaunchOptions } from './testing/browser/firefox-macos.js'

const batch = process.env.TUNGSTEN_TEST_BATCH
if (batch && !/^[a-z0-9-]+$/.test(batch)) throw new Error('Invalid Tungsten test batch name')
const report = batch ? `integration-${batch}` : 'integration'

const browsers = {
  chromium: devices['Desktop Chrome'],
  chrome: { ...devices['Desktop Chrome'], channel: 'chrome' },
  edge: { ...devices['Desktop Edge'], channel: 'msedge' },
  firefox: { ...devices['Desktop Firefox'], launchOptions: firefoxMacOSLaunchOptions() },
  webkit: devices['Desktop Safari'],
  'mobile-chromium': devices['Pixel 7'],
  'mobile-webkit': devices['iPhone 13'],
}

export default defineConfig<BrowserOptions>({
  testDir: './testing/browser/specs',
  outputDir: `test-results/${report}`,
  testIgnore: ['**/*.benchmark.ts', '**/*.profile.ts'],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalTimeout: 20 * 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  fullyParallel: true,
  reporter: [
    ['list'],
    ['html', { outputFolder: `playwright-report/${report}`, open: 'never' }],
    ['junit', { outputFile: `test-results/${report}.xml` }],
  ],
  use: {
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node testing/browser/server.mjs',
    wait: {
      stdout: /Tungsten production fixture: (?<playwright_test_base_url>http:\/\/127\.0\.0\.1:\d+)/,
    },
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: designs.flatMap((design) =>
    Object.entries(browsers).flatMap(([browser, device]) =>
      (['light', 'dark'] as const).map((colorScheme) => ({
        name: `${design}-${browser}${colorScheme === 'dark' ? '-dark' : ''}`,
        use: { ...device, design, designColorScheme: colorScheme, colorScheme },
      })),
    ),
  ),
})
