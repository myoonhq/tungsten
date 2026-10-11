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
