import { test, expect } from '../fixtures.js'

test('ASY-01: fresh dependent options clear invalid selections and rerun rules, including A→B→A', async ({
  open,
  page,
  driver,
  request,
  session,
}) => {
  await open('async')
  await driver.select('Region', 'Bratislava')
  await expect(driver.field('status')).toHaveValue('Region ready')
  await driver.select('Country', 'Czechia')
  await expect(page.getByRole('combobox', { name: 'Region' })).toHaveText('Select…')
  await expect(driver.field('status')).toHaveValue('Region cleared')
  await driver.select('Region', 'Brno')
  await driver.select('Country', 'Slovakia')
  await expect(page.getByRole('combobox', { name: 'Region' })).toHaveText('Select…')
  const state = await (await request.get(`/control/${session}`)).json()
  expect(
    state.requests
      .filter((r: { endpoint: string }) => r.endpoint === 'regions')
      .map((r: { country: string }) => r.country),
  ).toEqual(['SK', 'CZ', 'SK'])
})

test('ASY-02: failed fetch retries explicitly, stays disabled during slow recovery, then applies data', async ({
  open,
  page,
  driver,
  request,
  session,
  consoleChecks,
}) => {
  consoleChecks.allowHttpError(503)
  await request.post(`/control/${session}`, { data: { failures: 1 } })
  await open('async')
  await expect(page.getByRole('alert')).toContainText('503')
  await request.post(`/control/${session}`, { data: { held: true } })
  await driver.retry().click()
  await expect(page.getByRole('combobox', { name: 'Region' })).toBeDisabled()
  await expect(page.getByRole('status', { name: 'Loading options' })).toBeVisible()
  await expect
    .poll(async () => (await (await request.get(`/control/${session}`)).json()).waiters)
    .toBe(1)
  await request.post(`/control/${session}`, { data: { held: false } })
  await expect(page.getByRole('combobox', { name: 'Region' })).toBeEnabled()
  await driver.select('Region', 'Košice')
  await expect.poll(() => page.evaluate(() => window.fixture.snapshot!.values.region)).toBe('KE')
  const state = await (await request.get(`/control/${session}`)).json()
  expect(state.requests).toHaveLength(2)
})

test('ASY-03: transport loss is visible and a recovered connection permits an explicit retry', async ({
  page,
  open,
  driver,
  consoleChecks,
}) => {
  consoleChecks.allowNetworkError(/^Failed to load resource: net::ERR_INTERNET_DISCONNECTED$/)
  await page.route('**/api/*/regions*', (route) => route.abort('internetdisconnected'), {
    times: 1,
  })
  await open('async')
  await expect(page.getByRole('alert')).toBeVisible()
  await driver.retry().click()
  await expect(page.getByRole('combobox', { name: 'Region' })).toBeEnabled()
  await driver.select('Region', 'Bratislava')
  await expect(driver.field('status')).toHaveValue('Region ready')
})

for (const timing of ['submit', 'selection'] as const) {
  test(`ASY-04: ${timing} upload sends real multipart bytes and durable references before submission`, async ({
    open,
    page,
    driver,
    request,
    session,
  }) => {
    await open(timing === 'submit' ? 'files' : 'files-selection')
    await driver.field('Attachment').setInputFiles({
      name: 'proof.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('real upload proof'),
    })
    if (timing === 'submit') {
      await expect(page.getByRole('status')).toHaveText('Pending upload')
      expect((await (await request.get(`/control/${session}`)).json()).uploads).toHaveLength(0)
    } else await expect(page.getByRole('status')).toHaveText('Uploaded')
    await driver.submit().click()
    await expect(page.getByLabel('Submitted values')).toBeVisible()
    const state = await (await request.get(`/control/${session}`)).json()
    expect(state.uploads).toHaveLength(1)
    expect(state.uploads[0].multipart).toContain('multipart/form-data; boundary=')
    expect(state.uploads[0].body).toContain('real upload proof')
    expect(state.uploads[0].body).toContain('proof.txt')
    expect(state.submissions[0].attachment.files).toEqual([
      { id: 'stored-1', name: 'proof.txt', size: 17, mediaType: 'text/plain', uploaded: true },
    ])
  })
}
