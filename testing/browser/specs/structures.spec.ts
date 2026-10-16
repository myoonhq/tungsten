import { test, expect } from '../fixtures.js'
import { expectClearFieldLayout } from '../presentation.js'

const basic = [
  'group',
  'fragment',
  'section',
  'panel',
  'card',
  'inset',
  'fieldset',
  'row',
  'column',
  'collapsible',
  'accordion',
  'details',
  'expansion-panel',
  'modal',
  'drawer',
  'sheet',
]
const sections = ['tabs', 'segmented-view', 'wizard', 'stepper', 'pages', 'carousel']
for (const renderer of basic) {
  test(`Group / ${renderer}: hidden presentation errors reveal, focus and submit nested values`, async ({
    open,
    page,
    driver,
  }, testInfo) => {
    await open(`group-${renderer}`)
    await driver.submit().click()
    await expect(driver.field('Value')).toBeVisible()
    await expect(driver.field('Value')).toBeFocused()
    await driver.field('Value').fill('Nested value')
    await expectClearFieldLayout(page)
    if (['modal', 'drawer', 'sheet'].includes(renderer)) {
      const header = page.locator('.tg-group-dialog-header')
      const title = await header.locator('.tg-group-title').boundingBox()
      const description = await header.locator('.tg-description').boundingBox()
      expect(description!.y).toBeGreaterThanOrEqual(title!.y + title!.height)
    }
    if (['card', 'fieldset', 'drawer'].includes(renderer))
      await page.screenshot({ path: testInfo.outputPath(`group-${renderer}.png`), fullPage: true })
    if (['modal', 'drawer', 'sheet'].includes(renderer))
      await page.getByRole('button', { name: 'Close', exact: true }).click()
    await driver.submit().click()
    await expect(page.getByLabel('Submitted values')).toHaveText(
      JSON.stringify({ 'details.value': 'Nested value' }),
    )
  })
}
for (const renderer of sections) {
  test(`Sectioned group / ${renderer}: inactive sections block and reveal the first error`, async ({
    open,
    page,
    driver,
  }) => {
    await open(`section-${renderer}`)
    await expect(driver.field('flow.second.email')).toBeHidden()
    await driver.submit().click()
    await expect(driver.field('flow.second.email')).toBeVisible()
    await expect(driver.field('flow.second.email')).toBeFocused()
    await driver.field('flow.second.email').fill('ada@example.com')
    await expectClearFieldLayout(page)
    await driver.submit().click()
    await expect(page.getByLabel('Submitted values')).toHaveText(
      JSON.stringify({ 'flow.first.name': 'Ada', 'flow.second.email': 'ada@example.com' }),
    )
  })
}
for (const renderer of ['undereachother', 'tabs']) {
  test(`Repeater / ${renderer}: add, edit and remove a row before real submission`, async ({
    open,
    page,
    driver,
  }) => {
    await open(renderer === 'tabs' ? 'repeater-tabs' : 'repeater')
    await page.getByRole('button', { name: 'Add to People', exact: true }).click()
    await expect(page.getByLabel('Name', { exact: true }).first()).toBeVisible()
    await page.getByLabel('Name', { exact: true }).first().fill('Ada')
    await expectClearFieldLayout(page)
    await page.getByRole('button', { name: 'Add to People', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => window.fixture.snapshot!.values.people))
      .toHaveLength(2)
    await page
      .getByRole('button', { name: /Remove.*#/ })
      .filter({ visible: true })
      .last()
      .click()
    await driver.submit().click()
    await expect(page.getByLabel('Submitted values')).toHaveText(
      JSON.stringify({ people: [{ name: 'Ada' }] }),
    )
  })
}

test('Repeater / nested: parent reorder keeps child data attached; child add/remove stays isolated', async ({
  open,
  page,
  driver,
}, testInfo) => {
  await open('nested-repeater', {
    draft: JSON.stringify({
      people: [
        { name: 'Ada', children: [{ name: 'Ann' }] },
        { name: 'Grace', children: [{ name: 'Gina' }] },
      ],
    }),
  })
  await page
    .getByRole('region', { name: '#2', exact: true })
    .getByRole('button', { name: /Move #2 earlier/ })
    .click()
  await expect(page.getByLabel('Name', { exact: true }).first()).toHaveValue('Grace')
  await expect(page.getByLabel('Child name', { exact: true }).first()).toHaveValue('Gina')
  await page.getByRole('button', { name: 'Add to Children', exact: true }).first().click()
  await expect(page.getByLabel('Child name', { exact: true })).toHaveCount(3)
  await page.getByLabel('Child name', { exact: true }).nth(1).fill('Second child')
  await expectClearFieldLayout(page)
  await page.screenshot({ path: testInfo.outputPath('nested-repeaters.png'), fullPage: true })
  await driver.submit().click()
  await expect
    .poll(() => page.evaluate(() => window.fixture.submissions.at(-1)))
    .toEqual({
      people: [
        { name: 'Grace', children: [{ name: 'Gina' }, { name: 'Second child' }] },
        { name: 'Ada', children: [{ name: 'Ann' }] },
      ],
    })
})
