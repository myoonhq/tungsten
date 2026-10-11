import { test as base } from './assert-console.js'
import { expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'

// Register only implemented designs. Shared scenarios must never depend on pixels,
// DOM order or Tungsten CSS classes. Add a design-specific adapter if semantics differ.
export const designs = ['tungsten', 'bootstrap', 'material'] as const
export type Design = (typeof designs)[number]
export type BrowserOptions = {
  design: Design
  designColorScheme: 'light' | 'dark'
  formReadyTimeoutMs: number
}
export interface DesignDriver {
  field(label: string): Locator
  textInput(key: string): Locator
  select(label: string, option: string): Promise<void>
  removeChip(label: string): Locator
  clear(): Locator
  submit(): Locator
  retry(): Locator
  repeaterAction(collection: string, action: 'add' | 'removeLast' | 'moveFirstLater'): Locator
}
function tungsten(page: Page): DesignDriver {
  return {
    field: (label) =>
      page.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`)),
    // Native names identify schema keys without resolving labels across a huge form.
    // Each future design implements this lookup using its own control markup.
    textInput: (key) => page.locator(`:is(input, textarea)[name=${JSON.stringify(key)}]`),
    async select(label, option) {
      const control = page.getByRole('combobox', { name: label, exact: true })
      if ((await control.getAttribute('aria-expanded')) !== 'true') await control.click()
      const target = page
        .getByRole('listbox', { name: label, exact: true })
        .getByRole('option', { name: option, exact: true })
      if (!(await target.count())) await control.pressSequentially(option)
      await page
        .getByRole('listbox', { name: label, exact: true })
        .getByRole('option', { name: option, exact: true })
        .click()
    },
    removeChip: (label) => page.getByRole('button', { name: `Remove ${label}`, exact: true }),
    clear: () => page.getByRole('button', { name: 'Clear all', exact: true }),
    submit: () => page.getByRole('button', { name: 'Submit', exact: true }),
    retry: () => page.getByRole('button', { name: 'Retry loading', exact: true }),
    repeaterAction(collection, action) {
      const scope = page.getByRole('region', { name: collection, exact: true }).first()
      if (action === 'add')
        return scope.getByRole('button', { name: `Add to ${collection}`, exact: true })
      if (action === 'removeLast') return scope.getByRole('button', { name: /^Remove #/ }).last()
      return scope.getByRole('button', { name: /^Move #1(?: .*?)? later$/ }).first()
    },
  }
}
const adapters: Record<Design, (page: Page) => DesignDriver> = {
  tungsten,
  bootstrap: tungsten,
  material: tungsten,
}
export const test = base.extend<
  BrowserOptions & {
    driver: DesignDriver
    session: string
    open: (scenario: string, options?: Record<string, string>) => Promise<void>
  }
>({
  design: ['tungsten', { option: true }],
  designColorScheme: ['light', { option: true }],
  formReadyTimeoutMs: [5_000, { option: true }],
  driver: async ({ page, design }, provide) => {
    await provide(adapters[design](page))
  },
  session: async ({ request }, provide) => {
    const id = randomUUID()
    await request.post(`/control/${id}`, { data: {} })
    try {
      await provide(id)
    } finally {
      await request.delete(`/control/${id}`)
    }
  },
  open: async (
    { page, design, designColorScheme, driver, session, formReadyTimeoutMs },
    provide,
  ) => {
    await provide(async (scenario, options = {}) => {
      await page.goto(
        `/?${new URLSearchParams({ scenario, design, session, colorScheme: designColorScheme, ...options })}`,
      )
      const ready = {
        timeout: formReadyTimeoutMs,
        message: `${scenario}: initial form state must be ready within ${formReadyTimeoutMs} ms`,
      }
      if (options.observe === 'none') {
        const deadline = Date.now() + ready.timeout
        // Wait for the public lifecycle callback before querying layout during a
        // large React mount. This does not subscribe to or consume full state.
        await expect
          .poll(() => page.evaluate(() => !!window.fixture?.controller), {
            ...ready,
            message: `${scenario}: engine onReady must complete within ${ready.timeout} ms`,
          })
          .toBe(true)
        await expect(driver.textInput('field_0'), ready.message).toBeVisible({
          timeout: Math.max(1, deadline - Date.now()),
        })
      } else
        await expect.poll(() => page.evaluate(() => !!window.fixture?.snapshot), ready).toBe(true)
    })
  },
})
export { expect }
