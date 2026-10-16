import { test, expect } from '../fixtures.js'

test.beforeEach(({ design }) => {
  test.skip(design !== 'material', 'Material-specific presentation checks')
})

test('Material: public adapter renders MUI primitives with instance-local light/dark themes', async ({
  open,
  page,
  driver,
  designColorScheme,
}) => {
  await open('fields', { sibling: '1' })
  const form = driver.field('plain').locator('xpath=ancestor::form')
  await expect(form).toHaveClass(/tm-root/)
  await expect(driver.field('plain')).toHaveClass(/MuiOutlinedInput-input/)
  await expect(driver.field('quantity')).toHaveClass(/MuiOutlinedInput-input/)
  await expect(form.getByRole('button', { name: 'Submit', exact: true })).toHaveClass(
    /MuiButton-contained/,
  )
  await expect(form).toHaveCSS(
    'background-color',
    designColorScheme === 'dark' ? 'rgb(18, 18, 18)' : 'rgb(255, 255, 255)',
  )
  await expect(
    page.getByRole('textbox', { name: /^Day/ }).locator('xpath=ancestor::form'),
  ).toHaveAttribute('data-tg-color-scheme', 'light')
  expect(await page.locator('html').getAttribute('data-mui-color-scheme')).toBeNull()
})

test('Material: labels float on focus and values without obscuring text, including zero and multiline', async ({
  open,
  page,
  driver,
}, testInfo) => {
  await open('fields')
  const input = driver.field('plain')
  const label = input.locator('xpath=ancestor::*[contains(@class,"tg-field")][1]').locator('label')
  await expect(label).toHaveAttribute('data-shrink', 'false')
  await expect
    .poll(() => input.evaluate((node) => getComputedStyle(node, '::placeholder').opacity))
    .toBe('0')
  const inside = await label.boundingBox()
  await input.focus()
  await expect(label).toHaveAttribute('data-shrink', 'true')
  await expect.poll(async () => (await label.boundingBox())!.y).toBeLessThan(inside!.y - 5)
  await input.fill('Green shoots')
  await driver.field('quantity').fill('0')
  await expect(label).toHaveAttribute('data-shrink', 'true')
  const amount = driver
    .field('quantity')
    .locator('xpath=ancestor::*[contains(@class,"tg-field")][1]')
    .locator('label')
  await driver.field('notes').fill('A multiline draft')
  await expect(amount).toHaveAttribute('data-shrink', 'true')
  const notes = driver
    .field('notes')
    .locator('xpath=ancestor::*[contains(@class,"tg-field")][1]')
    .locator('label')
  await input.focus()
  await expect(notes).toHaveAttribute('data-shrink', 'true')
  await input.fill('')
  await driver.submit().focus()
  await expect(label).toHaveAttribute('data-shrink', 'false')
  await expect
    .poll(() => input.evaluate((node) => getComputedStyle(node, '::placeholder').opacity))
    .toBe('0')
  // A filled label sits in a closely fitted notch, above the value rather than inside it.
  await expect
    .poll(async () => {
      const field = await driver.field('notes').boundingBox()
      return (await notes.boundingBox())!.y < field!.y
    })
    .toBe(true)
  const legend = notes.locator('xpath=..').locator('legend')
  expect(await legend.textContent()).not.toMatch(/\*.*\*/)
  await expect
    .poll(async () => {
      const gap = (await legend.boundingBox())!.width
      const text = (await notes.boundingBox())!.width
      return Math.abs(gap - text - 10)
    })
    .toBeLessThan(2)
  await page.screenshot({
    path: testInfo.outputPath('material-floating-labels.png'),
    fullPage: true,
  })
})

test('Material: nested fieldsets keep empty outlines closed and floating notches fitted', async ({
  page,
  designColorScheme,
}, testInfo) => {
  await page.goto(`/?scenario=fields&editor=1&design=material&colorScheme=${designColorScheme}`)
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  // Exercise the same nested fieldset markup used by real Editor starter forms.
  await page.getByRole('tab', { name: 'JSON', exact: true }).click()
  await page.getByLabel('Schema JSON').fill(
    JSON.stringify({
      schemaVersion: 'sprout',
      form: [
        {
          type: 'group',
          key: 'group',
          variant: 'basic',
          view: { label: 'Contact' },
          render: { type: 'fieldset', settings: {} },
          subform: [
            {
              type: 'text',
              key: 'group.name',
              view: { label: 'Name', placeholder: 'Your full name' },
              validators: [{ kind: 'required' }],
            },
            { type: 'date', key: 'group.date', view: { label: 'Date' } },
            {
              type: 'select',
              key: 'group.choice',
              view: { label: 'Choice' },
              options: [{ value: 'a', label: 'Alpha' }],
            },
            {
              type: 'select',
              key: 'group.multiple',
              multiple: true,
              view: { label: 'Multiple' },
              options: [{ value: 'a', label: 'Alpha' }],
            },
          ],
        },
      ],
    }),
  )
  await page.getByRole('button', { name: 'Apply JSON', exact: true }).click()
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  const name = page.getByRole('textbox', { name: /^Name/ })
  const control = name.locator('xpath=ancestor::*[contains(@class,"MuiFormControl-root")][1]')
  const label = control.locator('label')
  const legend = control.locator('legend')
  await expect(label).toHaveAttribute('data-shrink', 'false')
  await expect(legend).toHaveCSS('padding-left', '0px')
  await expect.poll(async () => (await legend.boundingBox())!.width).toBeLessThan(1)
  for (const input of [name, page.getByRole('textbox', { name: 'Date', exact: true })])
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node, '::placeholder').opacity))
      .toBe('0')
  await name.fill('Ada')
  await page.getByRole('heading', { name: 'Live preview', exact: true }).click()
  await expect(label).toHaveAttribute('data-shrink', 'true')
  expect((await legend.textContent())!.match(/\*/g)).toHaveLength(1)
  await expect
    .poll(async () =>
      Math.abs((await legend.boundingBox())!.width - (await label.boundingBox())!.width - 10),
    )
    .toBeLessThan(2)
  await expect(name).toHaveCSS('box-shadow', 'none')
  const choice = page.getByRole('combobox', { name: 'Choice', exact: true })
  const choiceLabel = page.locator(`label[id="${await choice.getAttribute('aria-labelledby')}"]`)
  await expect(choiceLabel).toHaveAttribute('data-shrink', 'false')
  await choice.press('ArrowDown')
  await expect
    .poll(() =>
      choiceLabel.evaluate((label) => {
        const box = label.getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, box.bottom - 2)
        return hit === label || (hit !== null && label.contains(hit))
      }),
    )
    .toBe(true)
  await choice.press('Enter')
  await expect(choiceLabel).toHaveAttribute('data-shrink', 'true')
  await expect(choice).toHaveText('Alpha')
  const multiple = page.getByRole('combobox', { name: 'Multiple', exact: true })
  await multiple.click()
  await page.getByRole('option', { name: 'Alpha', exact: true }).click()
  await multiple.press('Escape')
  await expect(page.getByRole('button', { name: 'Remove Alpha', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await name.focus()
  await page.screenshot({
    path: testInfo.outputPath('material-editor-outlines.png'),
    fullPage: true,
  })
})

test('Material: MUI checkbox, switch and radio retain visible checked icons and native labels', async ({
  open,
  page,
  driver,
}) => {
  await open('fields')
  const checkbox = driver.field('checkbox')
  await checkbox.click()
  await expect(checkbox).toBeChecked()
  await expect(
    checkbox.locator('xpath=ancestor::*[contains(@class,"MuiCheckbox-root")]'),
  ).toHaveClass(/Mui-checked/)
  await expect(
    checkbox.locator('xpath=ancestor::*[contains(@class,"MuiCheckbox-root")]').locator('svg'),
  ).toBeVisible()
  const control = page.getByRole('switch', { name: 'switch' })
  await control.click()
  await expect(control).toBeChecked()
  await expect(
    control
      .locator('xpath=ancestor::*[contains(@class,"MuiSwitch-root")]')
      .locator('.MuiSwitch-thumb'),
  ).toBeVisible()
  const radio = page.getByRole('radio', { name: 'Yes', exact: true })
  await radio.click()
  await expect(radio).toBeChecked()
  await expect(radio.locator('xpath=ancestor::*[contains(@class,"MuiRadio-root")]')).toHaveClass(
    /Mui-checked/,
  )
})

test('Material: section navigation, repeaters and calendar actions use MUI buttons', async ({
  open,
  page,
}) => {
  await open('section-tabs')
  await expect(page.getByRole('tab').first()).toHaveClass(/MuiButton-root/)
  await open('repeater')
  await expect(page.getByRole('button', { name: 'Add to People', exact: true })).toHaveClass(
    /MuiButton-outlined/,
  )
  await open('date-locale')
  await page.getByRole('button', { name: /Choose date/ }).click()
  await expect(page.locator('.tg-calendar-day').first()).toHaveClass(/MuiButton-root/)
})

test('Material: textarea rows stay bounded without an autosizing measurement input', async ({
  open,
  page,
  driver,
}) => {
  await open('fields')
  const notes = driver.field('notes')
  await expect(notes).toHaveAttribute('rows', '3')
  await expect(notes).toHaveCSS('resize', 'none')
  expect(await notes.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(120)
  await expect(page.locator('textarea[aria-hidden=true]')).toHaveCount(0)
  await notes.fill('First line\nSecond line')
  await expect(notes).toHaveValue('First line\nSecond line')
})
