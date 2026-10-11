import { test, expect } from '../fixtures.js'

test('Fixture assets: the declared favicon is served without browser errors', async ({
  open,
  page,
  request,
}) => {
  await open('diagnostics')
  const href = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(href).toBeTruthy()
  const response = await request.get(new URL(href!, page.url()).href)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toBe('image/svg+xml')
})

test('Diagnostics / warning: localized callback preserves a successful operation without a modal', async ({
  open,
  page,
  driver,
}) => {
  await open('diagnostics')
  await driver.field('Source').fill('go')
  await expect(driver.field('Target')).toHaveValue('C')
  const diagnostics = await page.evaluate(() => window.fixture.diagnostics)
  expect(diagnostics).toEqual([
    expect.objectContaining({
      severity: 'warning',
      messageKey: 'tg_warning_multiple_value_writes',
      params: { fieldKey: 'target' },
      message: expect.stringContaining('target'),
    }),
  ])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
test('Diagnostics / processing error: mandatory feedback and rollback; reset permits correction', async ({
  open,
  page,
  driver,
  consoleChecks,
}) => {
  consoleChecks.expectError('tg_schema_patch_processing_exceeded_safety_limit')
  await open('diagnostics', { limit: '2' })
  await driver.field('Source').fill('go')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(driver.field('Source')).toHaveValue('')
  await expect(driver.field('Target')).toHaveValue('A')
  expect(await page.evaluate(() => window.fixture.diagnostics)).toEqual([
    expect.objectContaining({
      severity: 'error',
      messageKey: 'tg_schema_patch_processing_exceeded_safety_limit',
    }),
  ])
  await page.getByRole('button', { name: 'Reset form', exact: true }).click()
  await driver.field('Source').fill('safe')
  await expect.poll(() => page.evaluate(() => window.fixture.snapshot!.values.source)).toBe('safe')
})
test('Diagnostics / schema load error: load failure is visible and reaches the error callback', async ({
  page,
  session,
  design,
  consoleChecks,
}) => {
  consoleChecks.expectError('tg_schema_failed_to_load_form')
  await page.goto(`/?${new URLSearchParams({ scenario: 'invalid-schema', session, design })}`)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.fixture.diagnostics.length)).toBe(1)
  expect(await page.evaluate(() => window.fixture.diagnostics[0])).toMatchObject({
    severity: 'error',
    messageKey: expect.stringMatching(/^tg_/),
  })
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0)
})
