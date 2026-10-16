import { test, expect } from '../fixtures.js'
import { expectClearFieldLayout } from '../presentation.js'

test.beforeEach(({ design }) => {
  test.skip(design === 'tungsten', 'Optional design presentation audit')
})

test('Presentation: long group headings, zero gaps and nested repeater padding stay clear', async ({
  open,
  page,
}, testInfo) => {
  await open('presentation-spacing', {
    draft: JSON.stringify({ people: [{ name: 'Ada' }, { name: 'Grace' }] }),
  })
  await expectClearFieldLayout(page)
  for (const button of await page.locator('.tg-repeater-heading button').all()) {
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
  await page.screenshot({ path: testInfo.outputPath('group-repeater-spacing.png'), fullPage: true })
})

test('Presentation: scalar labels, hints and errors remain clear before and after editing', async ({
  open,
  page,
  driver,
}, testInfo) => {
  await open('fields')
  await expectClearFieldLayout(page)
  for (const [key, value] of [
    ['plain', 'Ada'],
    ['email', 'ada@example.com'],
    ['password', 'secret'],
    ['tel', '+421123'],
    ['notes', 'Line one\nLine two'],
    ['quantity', '0'],
  ])
    await driver.field(key).fill(value)
  await driver.submit().focus()
  await expectClearFieldLayout(page)
  await page.screenshot({ path: testInfo.outputPath('fields-filled.png'), fullPage: true })
})

test('Presentation: disabled controls, files and long select chips remain readable and reachable', async ({
  open,
  page,
  driver,
}, testInfo) => {
  await open('theme-controls')
  await expectClearFieldLayout(page)
  await expect(driver.field('disabled')).toBeDisabled()
  await expect(driver.field('readonly')).toHaveAttribute('readonly')
  const picker = page.locator('.tg-file-picker')
  const input = picker.locator('input[type=file]')
  const bounds = await picker.boundingBox()
  const hit = await input.boundingBox()
  expect(hit!.width).toBeGreaterThanOrEqual(bounds!.width - 2)
  expect(hit!.height).toBeGreaterThanOrEqual(bounds!.height - 2)
  await page.screenshot({ path: testInfo.outputPath('choices-files-states.png'), fullPage: true })
  await open('select')
  const choice = page.getByRole('combobox', { name: 'Choices', exact: true })
  await choice.click()
  await page.getByRole('option', { name: /A very long option label/ }).click()
  await choice.press('Escape')
  await expectClearFieldLayout(page)
  const chip = page.locator('.tg-select-chip')
  const remove = chip.getByRole('button', { name: /Remove/ })
  await expect(remove).toBeVisible()
  const label = chip.locator('.tg-select-chip-label')
  const labelBox = await label.boundingBox(),
    removeBox = await remove.boundingBox()
  expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(removeBox!.x + 1)
  await remove.click()
  await expect(chip).toHaveCount(0)
})
