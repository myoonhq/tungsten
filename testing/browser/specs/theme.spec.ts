import { test, expect } from '../fixtures.js'
import type { Locator } from '@playwright/test'

async function colors(element: Locator) {
  return element.evaluate((node) => {
    const style = getComputedStyle(node)
    return { foreground: style.color, background: style.backgroundColor, scheme: style.colorScheme }
  })
}
function luminance(color: string) {
  const [r, g, b] = color
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number)
    .map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test('Theme: field, error and action colors stay readable in both schemes', async ({
  open,
  page,
  driver,
  design,
  designColorScheme: colorScheme,
}) => {
  await open('fields')
  const form = driver.field('plain').locator('xpath=ancestor::form')
  const surface = await colors(form)
  if (design === 'tungsten' && colorScheme === 'dark')
    expect(surface.background).toBe('rgb(27, 37, 27)')
  expect(surface.scheme).toBe(colorScheme)
  expect(luminance(surface.background) < 0.1).toBe(colorScheme === 'dark')
  const input = await colors(driver.field('plain'))
  expect(contrast(input.foreground, input.background)).toBeGreaterThanOrEqual(4.5)
  const action = await colors(driver.submit())
  expect(contrast(action.foreground, action.background)).toBeGreaterThanOrEqual(4.5)
  await driver.submit().click()
  const error = page.locator('.tg-errors').first()
  await expect(error).toBeVisible()
  expect(contrast((await colors(error)).foreground, surface.background)).toBeGreaterThanOrEqual(4.5)
  await driver.field('plain').focus()
  if (design === 'material') {
    const outline = form
      .locator('.MuiOutlinedInput-root')
      .filter({ has: driver.field('plain') })
      .locator('fieldset')
    await expect(outline).toHaveCSS('border-top-width', '2px')
    // Focus follows the notched outline rather than painting through the floating label.
    await expect(driver.field('plain')).toHaveCSS('box-shadow', 'none')
  } else await expect(driver.field('plain')).toHaveCSS('box-shadow', /^(?!none$).+/)
  await driver.submit().hover()
  await expect
    .poll(async () => {
      const hover = await colors(driver.submit())
      return contrast(hover.foreground, hover.background)
    })
    .toBeGreaterThanOrEqual(4.5)
})

test('Theme: switching preserves edits, errors, focus and controller identity and isolates siblings', async ({
  open,
  page,
  driver,
  designColorScheme: colorScheme,
}) => {
  await open('fields', { sibling: '1' })
  const input = driver.field('plain')
  await input.fill('A')
  await expect.poll(() => page.evaluate(() => window.fixture.snapshot!.values.plain)).toBe('A')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await input.focus()
  const before = await page.evaluate(() => {
    Object.assign(window, { themeController: window.fixture.controller })
    return window.fixture.emissions
  })
  const next = colorScheme === 'dark' ? 'light' : 'dark'
  await page.evaluate((scheme) => window.fixture.setColorScheme(scheme as 'light' | 'dark'), next)
  await expect(input.locator('xpath=ancestor::form')).toHaveAttribute('data-tg-color-scheme', next)
  await expect(input).toHaveValue('A')
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(await page.evaluate(() => window.fixture.emissions)).toBe(before)
  expect(
    await page.evaluate(() => window.fixture.controller === Reflect.get(window, 'themeController')),
  ).toBe(true)
  expect((await colors(page.getByRole('textbox', { name: /^Day/ }))).scheme).toBe('light')
})

test('Theme: overlays and their fields inherit the form palette', async ({
  open,
  page,
  driver,
  designColorScheme: colorScheme,
}) => {
  await open('group-modal')
  await driver.submit().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const palette = await colors(dialog)
  expect(palette.scheme).toBe(colorScheme)
  expect(luminance(palette.background) < 0.1).toBe(colorScheme === 'dark')
  expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(4.5)
  await driver.field('Value').fill('Preserved')
  await page.evaluate(
    (scheme) => window.fixture.setColorScheme(scheme as 'light' | 'dark'),
    colorScheme === 'dark' ? 'light' : 'dark',
  )
  await expect(dialog).toBeVisible()
  await expect(driver.field('Value')).toHaveValue('Preserved')
  await expect(driver.field('Value')).toBeFocused()
})

test('Theme: the calendar uses the form surface and readable selected-day colors', async ({
  open,
  page,
  designColorScheme: colorScheme,
}) => {
  await open('date-locale')
  await page.getByRole('button', { name: /Choose date/ }).click()
  const menu = page.locator('.tg-date-menu')
  await expect(menu).toBeVisible()
  expect((await colors(menu)).scheme).toBe(colorScheme)
  expect(luminance((await colors(menu)).background) < 0.1).toBe(colorScheme === 'dark')
  const selected = await colors(page.locator('.tg-calendar-day[data-selected="true"]'))
  expect(contrast(selected.foreground, selected.background)).toBeGreaterThanOrEqual(4.5)
})

test('Theme: editor settings, JSON drafts and preview inherit and survive a mode change', async ({
  page,
  design,
  designColorScheme: colorScheme,
}, testInfo) => {
  await page.goto(`/?scenario=fields&editor=1&design=${design}&colorScheme=${colorScheme}`)
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  const editor = page.locator('.te-root')
  expect((await colors(editor)).scheme).toBe(colorScheme)
  expect(luminance((await colors(editor)).background) < 0.1).toBe(colorScheme === 'dark')
  await page.getByRole('button', { name: 'plain plain', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect((await colors(dialog)).scheme).toBe(colorScheme)
  expect(luminance((await colors(dialog)).background) < 0.1).toBe(colorScheme === 'dark')
  const settings = dialog.locator('.tg-root')
  await expect(settings).toHaveAttribute('data-tg-color-scheme', colorScheme)
  const apply = dialog.getByRole('button', { name: 'Apply changes', exact: true })
  await expect(apply).toBeEnabled()
  await apply.hover()
  await expect
    .poll(async () => {
      const action = await colors(apply)
      return contrast(action.foreground, action.background)
    })
    .toBeGreaterThanOrEqual(4.5)
  await page.getByRole('button', { name: 'Close settings', exact: true }).click()
  await page.getByRole('tab', { name: 'JSON', exact: true }).click()
  const json = page.getByLabel('Schema JSON')
  await json.fill('{unfinished')
  const next = colorScheme === 'dark' ? 'light' : 'dark'
  await page.evaluate((scheme) => window.fixture.setColorScheme(scheme as 'light' | 'dark'), next)
  await expect(editor).toHaveAttribute('data-tg-color-scheme', next)
  await expect(json).toHaveValue('{unfinished')
  await expect(json).toBeFocused()
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  const preview = page.getByRole('textbox', { name: /^plain/ }).locator('xpath=ancestor::form')
  await expect(preview).toHaveAttribute('data-tg-color-scheme', next)
  if (design === 'tungsten') {
    // Authoring and rendered forms use one palette, including after a theme change.
    expect(await colors(preview)).toEqual(await colors(editor))
    const previewAction = await colors(preview.getByRole('button', { name: 'Submit', exact: true }))
    const editorAction = await editor.evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--te-color-action').trim(),
    )
    const formAction = await preview.evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--tg-color-action').trim(),
    )
    expect(editorAction).toBe(formAction)
    expect(contrast(previewAction.foreground, previewAction.background)).toBeGreaterThanOrEqual(4.5)
    await editor.screenshot({ path: testInfo.outputPath(`sprout-editor-${next}.png`) })
  }
})

test('Theme: disabled/read-only controls, choices, chips and files use their state palettes', async ({
  open,
  page,
  driver,
  designColorScheme: colorScheme,
}) => {
  await open('theme-controls')
  await expect(driver.field('readonly')).toHaveAttribute('readonly', '')
  await expect(driver.field('disabled')).toBeDisabled()
  const readOnly = await colors(driver.field('readonly'))
  expect(contrast(readOnly.foreground, readOnly.background)).toBeGreaterThanOrEqual(4.5)
  expect(readOnly.scheme).toBe(colorScheme)
  expect((await colors(driver.field('disabled'))).scheme).toBe(colorScheme)
  await page.getByRole('combobox', { name: 'Choice', exact: true }).click()
  const selected = await colors(page.getByRole('option', { name: 'Alpha', exact: true }))
  expect(contrast(selected.foreground, selected.background)).toBeGreaterThanOrEqual(4.5)
  const next = colorScheme === 'dark' ? 'light' : 'dark'
  await page.evaluate((scheme) => window.fixture.setColorScheme(scheme as 'light' | 'dark'), next)
  await expect(page.getByRole('listbox', { name: 'Choice', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Choice', exact: true }).press('Escape')
  const chip = await colors(page.locator('.tg-select-chip'))
  expect(contrast(chip.foreground, chip.background)).toBeGreaterThanOrEqual(4.5)
  const radio = await colors(
    page.locator('.tg-radio-option').filter({ has: page.locator(':checked') }),
  )
  expect(contrast(radio.foreground, radio.background)).toBeGreaterThanOrEqual(4.5)
  await expect
    .poll(async () => {
      const picker = await colors(page.locator('.tg-file-picker'))
      return contrast(picker.foreground, picker.background)
    })
    .toBeGreaterThanOrEqual(4.5)
  await expect(page.getByRole('switch', { name: 'Switch' })).toBeChecked()
})

test('Theme: an explicit package scheme remains independent of browser preference', async ({
  open,
  page,
  driver,
  designColorScheme: colorScheme,
}) => {
  await page.emulateMedia({ colorScheme: colorScheme === 'dark' ? 'light' : 'dark' })
  await open('fields')
  const palette = await colors(driver.field('plain').locator('xpath=ancestor::form'))
  expect(palette.scheme).toBe(colorScheme)
  expect(luminance(palette.background) < 0.1).toBe(colorScheme === 'dark')
})
