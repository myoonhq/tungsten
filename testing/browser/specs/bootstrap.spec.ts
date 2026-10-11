import { test, expect } from '../fixtures.js'

test.beforeEach(({ design }) => {
  test.skip(design !== 'bootstrap', 'Bootstrap-specific presentation checks')
})

test('Bootstrap: public adapter uses Bootstrap classes, variables and form-local color modes', async ({
  open,
  page,
  driver,
  designColorScheme,
}) => {
  await open('fields', { sibling: '1' })
  const form = driver.field('plain').locator('xpath=ancestor::form')
  await expect(form).toHaveClass(/tb-root/)
  await expect(form).toHaveAttribute('data-bs-theme', designColorScheme)
  await expect(driver.field('plain')).toHaveClass(/form-control/)
  await expect(driver.field('quantity')).toHaveClass(/form-control/)
  const submit = form.getByRole('button', { name: 'Submit', exact: true })
  await expect(submit).toHaveClass(/btn-primary/)
  await expect(form).toHaveCSS(
    'background-color',
    designColorScheme === 'dark' ? 'rgb(33, 37, 41)' : 'rgb(255, 255, 255)',
  )
  expect(await page.locator('html').getAttribute('data-bs-theme')).toBeNull()
  await expect(
    page.getByRole('textbox', { name: /^Day/ }).locator('xpath=ancestor::form'),
  ).toHaveAttribute('data-bs-theme', 'light')
  await form.evaluate((node) => (node as HTMLElement).style.setProperty('--bs-primary', '#123456'))
  await expect(submit).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await submit.focus()
  await expect(submit).toHaveCSS('box-shadow', /^(?!none$).+/)
})

test('Bootstrap: checked checkbox and radio retain visible marks', async ({
  open,
  page,
  driver,
}) => {
  await open('fields')
  const checkbox = driver.field('checkbox')
  await checkbox.click()
  await expect(checkbox).toBeChecked()
  await expect(checkbox).toHaveCSS('background-image', /url\(/)
  const radio = page.getByRole('radio', { name: 'Yes', exact: true })
  await radio.click()
  await expect(radio).toBeChecked()
  await expect(radio).toHaveCSS('background-image', /url\(/)
})

test('Bootstrap: section tabs and repeated cards receive Bootstrap presentation', async ({
  open,
  page,
}) => {
  await open('section-tabs')
  await expect(page.getByRole('tablist')).toHaveClass(/nav-tabs/)
  await expect(page.getByRole('tab').first()).toHaveClass(/nav-link/)
  await open('repeater')
  await page.getByRole('button', { name: 'Add to People', exact: true }).click()
  await expect(page.locator('.tg-repeater-instance').first()).toHaveClass(/card/)
})
