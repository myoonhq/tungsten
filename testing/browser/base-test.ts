import { test as base } from '@playwright/test'
export { expect, type Page } from '@playwright/test'

// Read after Playwright has captured the address of this run's listening server.
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture arguments.
  baseURL: async ({}, provide) => {
    const origin = process.env.PLAYWRIGHT_TEST_BASE_URL
    if (!origin) throw new Error('Playwright did not capture the test server address')
    await provide(origin)
  },
})
