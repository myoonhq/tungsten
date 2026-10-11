import { test, expect } from '../fixtures.js'

for (const language of ['th-TH', 'ar-EG'])
  test(`FLD-01: ${language} date entry uses Gregorian years and preserves dates on language changes`, async ({
    page,
    open,
    driver,
  }) => {
    await open('date-locale', { language })
    const input = driver.field('Day')
    await expect(input).toHaveValue(/2026/)
    const localized = await page.evaluate(
      (language) =>
        new Intl.DateTimeFormat(language, {
          calendar: 'gregory',
          numberingSystem: 'latn',
          timeZone: 'UTC',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date('2026-10-11T00:00:00Z')),
      language,
    )
    await input.fill(localized)
    await expect
      .poll(() => page.evaluate(() => window.fixture.snapshot!.values.day))
      .toBe('2026-10-11')
    const emissions = await page.evaluate(() => window.fixture.emissions)
    await page.getByRole('button', { name: 'Change language' }).click()
    await expect(input).toHaveValue('10/11/2026')
    expect(await page.evaluate(() => window.fixture.emissions)).toBe(emissions)
    await driver.submit().click()
    await expect(page.getByLabel('Submitted values')).toHaveText('{"day":"2026-10-11"}')
  })

for (const { key, initial, entered, expected, inputType } of [
  { key: 'plain', initial: 'Ada', entered: 'Grace', expected: 'Grace', inputType: 'text' },
  {
    key: 'email',
    initial: 'ada@example.com',
    entered: ' grace@example.com ',
    expected: 'grace@example.com',
    inputType: 'email',
  },
  {
    key: 'password',
    initial: 'secret',
    entered: ' another secret ',
    expected: ' another secret ',
    inputType: 'password',
  },
  { key: 'tel', initial: '+421 123', entered: '+36 456', expected: '+36 456', inputType: 'tel' },
  {
    key: 'notes',
    initial: 'first\nsecond',
    entered: 'edited\nmultiline',
    expected: 'edited\nmultiline',
    inputType: null,
  },
  { key: 'quantity', initial: 1, entered: '0', expected: 0, inputType: 'number' },
  {
    key: 'day',
    initial: '2024-02-29',
    entered: '2026-10-08',
    expected: '2026-10-08',
    inputType: null,
  },
  { key: 'time', initial: '09:30', entered: '10:45', expected: '10:45:00', inputType: null },
  {
    key: 'meeting',
    initial: '2026-10-07T08:30:00Z',
    entered: '2026-10-07T11:30',
    expected: '2026-10-07T09:30:00Z',
    inputType: null,
  },
]) {
  test(`Field / ${key}: restores draft, edits, normalizes and submits`, async ({
    open,
    page,
    driver,
  }) => {
    await open(`field-${key}`, { draft: JSON.stringify({ [key]: initial }) })
    if (inputType) await expect(driver.field(key)).toHaveAttribute('type', inputType)
    if (key === 'notes') await expect(driver.field(key)).toHaveJSProperty('tagName', 'TEXTAREA')
    await driver.field(key).fill(entered)
    await expect
      .poll(() => page.evaluate((key) => window.fixture.snapshot!.values[key], key))
      .toBe(expected)
    await driver.submit().click()
    await expect(page.getByLabel('Submitted values')).toHaveText(
      JSON.stringify({ [key]: expected }),
    )
  })
}
for (const variant of ['checkbox', 'switch', 'radio']) {
  test(`Field / boolean-${variant}: required false is a value, then true and false round trip`, async ({
    open,
    page,
    driver,
  }) => {
    await open(`field-${variant}`, { draft: JSON.stringify({ [variant]: false }) })
    if (variant === 'radio') await page.getByRole('radio', { name: 'Yes', exact: true }).click()
    else await driver.field(variant).click()
    await expect
      .poll(() => page.evaluate((key) => window.fixture.snapshot!.values[key], variant))
      .toBe(true)
    if (variant === 'radio') await page.getByRole('radio', { name: 'No', exact: true }).click()
    else await driver.field(variant).click()
    await expect
      .poll(() => page.evaluate((key) => window.fixture.snapshot!.values[key], variant))
      .toBe(false)
    await driver.submit().click()
    await expect(page.getByLabel('Submitted values')).toHaveText(
      JSON.stringify({ [variant]: false }),
    )
  })
}

test('Field / date-datetime: daylight-saving gap is rejected and retained for correction', async ({
  open,
  page,
  driver,
}) => {
  await open('field-meeting')
  await driver.field('meeting').fill('2026-03-29T02:30')
  await driver.submit().click()
  await expect(driver.field('meeting')).toHaveAttribute('aria-invalid', 'true')
  await expect(driver.field('meeting')).toHaveValue('03/29/2026, 02:30 AM')
  expect(await page.evaluate(() => window.fixture.submissions)).toHaveLength(0)
  await driver.field('meeting').fill('2026-03-29T03:30')
  await driver.submit().click()
  await expect(page.getByLabel('Submitted values')).toHaveText(
    JSON.stringify({ meeting: '2026-03-29T01:30:00Z' }),
  )
})

test('Field / incremental updates: rapid edits, dependent values, retained snapshots and reset stay synchronized', async ({
  open,
  page,
}) => {
  await open('benchmark', { count: '100', mounted: '100', limit: '1000' })
  const edited = page.locator('input[name="field_0"]')
  const dependent = page.locator('input[name="field_1"]')
  const unrelated = await page.locator('input[name="field_3"]').elementHandle()
  await page.evaluate(() => {
    window.retainedFieldSnapshot = window.fixture.snapshot!
    Object.freeze(window.retainedFieldSnapshot.state.fields.field_0)
    Object.freeze(window.retainedFieldSnapshot.state.fields)
  })
  const before = await page.evaluate(() => ({ ...window.fixture.renders }))
  for (const value of ['odd', 'even', 'odd', 'even', 'odd']) {
    await edited.fill(value)
    await expect(dependent).toHaveValue(value)
    await expect(edited).toHaveValue(value)
    await expect
      .poll(() => page.evaluate(() => window.fixture.snapshot?.values.field_1))
      .toBe(value)
  }
  const retained = await page.evaluate(() => ({
    oldValue: window.retainedFieldSnapshot!.values.field_0,
    oldStateValue: window.retainedFieldSnapshot!.state.fields.field_0.value,
    unchangedState:
      window.fixture.snapshot!.state.fields.field_3 ===
      window.retainedFieldSnapshot!.state.fields.field_3,
    renders: window.fixture.renders,
  }))
  expect(retained.oldValue).toBe('ready')
  expect(retained.oldStateValue).toBe('ready')
  expect(retained.unchangedState).toBe(true)
  for (const [key, count] of Object.entries(before)) {
    if (key !== 'field_0' && key !== 'field_1') expect(retained.renders[key]).toBe(count)
  }
  expect(
    await page.evaluate(
      (node) => node === document.querySelector('input[name="field_3"]'),
      unrelated,
    ),
  ).toBe(true)
  await page.evaluate(() => window.fixture.controller!.reset())
  await expect(edited).toHaveValue('ready')
  await expect(dependent).toHaveValue('ready')
  await expect
    .poll(() => page.evaluate(() => window.fixture.snapshot?.values.field_1))
    .toBe('ready')
  expect(await page.evaluate(() => window.retainedFieldSnapshot!.state.fields.field_0.value)).toBe(
    'ready',
  )
})

declare global {
  interface Window {
    retainedFieldSnapshot?: import('../../../framework/react/src/types.js').TungstenSnapshot
  }
}

test('Field / large select: wrapped rows, scrolling, End/Home and reset retain complete fresh options', async ({
  open,
  page,
  request,
  session,
}) => {
  await request.post(`/control/${session}`, { data: { longOptions: true } })
  await open('benchmark-options')
  await expect
    .poll(() => page.evaluate(() => window.fixture.snapshot?.state.fields.choices.options?.length))
    .toBe(10000)
  const control = page.getByRole('combobox', { name: 'Choices', exact: true })
  await control.click()
  expect(await page.getByRole('option').count()).toBeLessThan(60)
  const first = page.getByRole('option', { name: /^Option 0 —/ })
  const second = page.getByRole('option', { name: 'Option 1', exact: true })
  await expect.poll(async () => (await first.boundingBox())?.height ?? 0).toBeGreaterThan(36)
  const bounds = await first.boundingBox(),
    next = await second.boundingBox()
  expect(next!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height - 1)
  await control.press('End')
  const last = page.getByRole('option', { name: 'Option 9999', exact: true })
  await expect(last).toBeVisible()
  await expect(last).toBeInViewport({ ratio: 0.5 })
  await expect(control).toHaveAttribute(
    'aria-activedescendant',
    (await last.getAttribute('id')) as string,
  )
  await control.press('Home')
  await expect(first).toBeVisible()
  await expect(first).toBeInViewport({ ratio: 0.5 })
  await control.press('End')
  await control.press('Enter')
  await expect
    .poll(() => page.evaluate(() => window.fixture.snapshot?.values.choices))
    .toBe('option-9999')
  await expect(control).toContainText('Option 9999')
  await page.evaluate(() => window.fixture.controller!.reset())
  await expect
    .poll(async () => {
      const state = await (await request.get(`/control/${session}`)).json()
      return state.requests.filter(
        (request: { endpoint: string }) => request.endpoint === 'options',
      ).length
    })
    .toBe(2)
  await expect
    .poll(() => page.evaluate(() => window.fixture.snapshot?.state.fields.choices.options?.length))
    .toBe(10000)
})
