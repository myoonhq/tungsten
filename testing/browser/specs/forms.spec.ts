import { test, expect } from '../fixtures.js'

const long =
  'A very long option label that should wrap inside the input without making its remove button unreachable'

for (const variant of ['radio', 'select', 'multiple', 'file'])
  test(`UI-01: invalid read-only ${variant} is focused on submission`, async ({
    page,
    open,
    driver,
  }) => {
    await open(`readonly-${variant}`)
    await driver.submit().focus()
    await driver.submit().click()
    const control =
      variant === 'radio'
        ? page.getByRole('radio', { name: 'Yes', exact: true })
        : page.locator('[name="answer"]')
    await expect(control).toBeFocused()
    await expect(control).not.toHaveAttribute('disabled')
    if (variant !== 'file') await expect(control).toBeEnabled()
    await expect(control).toHaveAttribute('aria-invalid', 'true')
    if (variant === 'radio') await control.press('ArrowRight')
    else if (variant !== 'file') {
      await control.press('ArrowDown')
      await control.click()
      await expect(page.getByRole('listbox')).toHaveCount(0)
    } else {
      let opened = false
      page.on('filechooser', () => {
        opened = true
      })
      await control.press('Enter')
      await control.click({ force: true })
      expect(opened).toBe(false)
    }
    expect(await page.evaluate(() => window.fixture.snapshot!.values.answer)).toEqual(
      variant === 'multiple' ? [] : variant === 'file' ? { files: [] } : null,
    )
    expect(await page.evaluate(() => window.fixture.submissions)).toEqual([])
  })

test('REL-01: an ordinary HTTP deployment submits without secure-context randomUUID', async ({
  page,
  open,
  driver,
  request,
  session,
}) => {
  await open('benchmark', { count: '2', mounted: '2' })
  const local = new URL(page.url())
  const deployed = new URL(local)
  deployed.hostname = 'tungsten-http.test'
  await page.route(`${deployed.origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: `${local.origin}${url.pathname}${url.search}` })
    await route.fulfill({ response })
  })
  await page.goto(deployed.href)
  await expect.poll(() => page.evaluate(() => !!window.fixture?.controller)).toBe(true)
  expect(await page.evaluate(() => isSecureContext)).toBe(false)
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
  await driver.submit().click()
  await expect(page.getByLabel('Submitted values')).toBeVisible()
  expect((await (await request.get(`/control/${session}`)).json()).submissions).toEqual([
    { field_0: 'ready', field_1: 'ready' },
  ])
})

test('FLD-01/UI-01: all scalar variants survive a draft, edits and real HTTP submission', async ({
  page,
  open,
  driver,
  request,
  session,
}) => {
  await open('fields', {
    draft: JSON.stringify({
      plain: 'Ada',
      email: 'ada@example.com',
      password: 'secret',
      tel: '+421123',
      notes: 'line one\nline two',
      quantity: 0,
      checkbox: false,
      switch: true,
      radio: false,
      day: '2024-02-29',
      time: '09:30',
      meeting: '2026-10-07T08:30:00Z',
    }),
  })
  await expect(driver.field('password')).toHaveAttribute('type', 'password')
  await expect(driver.field('password')).toHaveValue('secret')
  await expect(driver.field('notes')).toHaveValue('line one\nline two')
  await expect(page.getByRole('radio', { name: 'No', exact: true })).toBeChecked()
  await driver.field('plain').fill('Grace')
  await expect.poll(() => page.evaluate(() => window.fixture.snapshot!.values.plain)).toBe('Grace')
  await driver.submit().click()
  await expect(page.getByLabel('Submitted values')).toBeVisible()
  const state = await (await request.get(`/control/${session}`)).json()
  expect(state.submissions).toEqual([
    {
      plain: 'Grace',
      email: 'ada@example.com',
      password: 'secret',
      tel: '+421123',
      notes: 'line one\nline two',
      quantity: 0,
      checkbox: false,
      switch: true,
      radio: false,
      day: '2024-02-29',
      time: '09:30:00',
      meeting: '2026-10-07T08:30:00Z',
    },
  ])
  const before = await page.evaluate(() => window.fixture.emissions)
  await page.getByRole('button', { name: 'Change language' }).click()
  await expect(driver.field('Text')).toHaveValue('Grace')
  expect(await page.evaluate(() => window.fixture.emissions)).toBe(before)
})

test('FLD-02: invalid values remain editable and block submission', async ({
  open,
  driver,
  page,
  request,
  session,
}) => {
  await open('fields', { draft: JSON.stringify({ checkbox: false }) })
  await driver.field('plain').fill('A')
  await driver.field('email').fill('invalid-email')
  await driver.submit().click()
  await expect(driver.field('plain')).toHaveAttribute('aria-invalid', 'true')
  await expect(driver.field('email')).toHaveValue('invalid-email')
  await expect
    .poll(async () => (await (await request.get(`/control/${session}`)).json()).submissions.length)
    .toBe(0)
  await expect(page.getByText('Must contain at least 2 characters.')).toBeVisible()
})

test('UI-04: inactive tabs validate and submission reveals/focuses the first invalid field', async ({
  open,
  page,
  driver,
}) => {
  await open('tabs')
  await expect(driver.field('flow.second.email')).toBeHidden()
  await driver.submit().click()
  await expect(page.getByRole('tab', { name: /Second/ })).toHaveAttribute('aria-selected', 'true')
  await expect(driver.field('flow.second.email')).toBeFocused()
})

test('UI-06: multiline multi-select, rapid chip removal while open, clear and keyboard choices', async ({
  open,
  page,
  driver,
}) => {
  await open('select')
  await driver.select('Choices', long)
  await driver.select('Choices', 'Beta')
  await driver.select('Choices', 'Gamma')
  await expect(page.getByRole('option', { name: long, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(driver.removeChip(long)).toBeVisible()
  const bounds = await driver.removeChip(long).boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await driver.removeChip('Beta').click()
  await driver.removeChip('Gamma').click()
  await expect
    .poll(() => page.evaluate(() => window.fixture.snapshot!.values.choices))
    .toEqual(['a'])
  await expect(page.getByRole('listbox')).toBeVisible()
  await driver.clear().click()
  await expect.poll(() => page.evaluate(() => window.fixture.snapshot!.values.choices)).toEqual([])
  const control = page.getByRole('combobox', { name: 'Choices' })
  await control.press('Escape')
  await control.press('Home')
  await control.press('Enter')
  await expect
    .poll(() => page.evaluate(() => window.fixture.snapshot!.values.choices))
    .toEqual(['a'])
})

test('SCH-05: reorder/remove repeater instances preserves the correct submitted row data', async ({
  open,
  page,
  driver,
}) => {
  await open('repeater', {
    draft: JSON.stringify({ people: [{ name: 'Ada' }, { name: 'Grace' }] }),
  })
  await page
    .getByRole('button', { name: /Move.*earlier/i })
    .last()
    .click()
  await expect(page.getByLabel('Name', { exact: true }).first()).toHaveValue('Grace')
  await page
    .getByRole('button', { name: /Remove.*#/i })
    .last()
    .click()
  await driver.submit().click()
  await expect(page.getByLabel('Submitted values')).toHaveText(
    JSON.stringify({ people: [{ name: 'Grace' }] }),
  )
})

for (const scenario of ['fields', 'nested-repeater']) {
  test(`Layout / ${scenario}: desktop and mobile controls stay inside the viewport`, async ({
    open,
    page,
  }) => {
    await open(scenario)
    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1)
  })
}
