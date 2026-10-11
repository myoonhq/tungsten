import languages from '../../../api/src/locales/languages.json' with { type: 'json' }
import english from '../../../api/src/locales/en.json' with { type: 'json' }
import { test, expect } from '../fixtures.js'

const submits = {
  en: 'Submit',
  sk: 'Odoslať',
  hu: 'Beküldés',
  de: 'Absenden',
  es: 'Enviar',
  fr: 'Envoyer',
}
const required = {
  en: 'This field is required.',
  sk: 'Toto pole je povinné.',
  hu: 'Ez a mező kötelező.',
  de: 'Dieses Feld ist erforderlich.',
  es: 'Este campo es obligatorio.',
  fr: 'Ce champ est obligatoire.',
}

for (const language of Object.keys(languages) as (keyof typeof submits)[])
  test(`I18N: packed ${language} messages load automatically and survive language changes`, async ({
    page,
    open,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const requests: string[] = []
    page.on('request', (request) => requests.push(new URL(request.url()).pathname))
    await open('fields', { language, i18n: '1' })
    await expect(page.getByRole('button', { name: submits[language], exact: true })).toBeVisible()
    await expect(page.getByText(required[language], { exact: true }).first()).toBeVisible()
    const catalogRequests = (tag: string) =>
      requests.filter((path) => path.startsWith(`/assets/${tag}-`) && path.endsWith('.js'))
    if (language !== 'en') expect(catalogRequests(language).length).toBeGreaterThan(0)
    for (const other of Object.keys(languages).filter(
      (other) => other !== language && other !== 'en',
    ))
      expect(catalogRequests(other)).toEqual([])
    await page.locator('[name="plain"]').fill('Retained edit')
    await expect
      .poll(() => page.evaluate(() => window.fixture.snapshot?.values.plain))
      .toBe('Retained edit')
    const emissions = await page.evaluate(() => window.fixture.emissions)
    await page.getByLabel('Fixture language').selectOption('en')
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeVisible()
    await page.getByLabel('Fixture language').selectOption(language)
    await expect(page.getByRole('button', { name: submits[language], exact: true })).toBeVisible()
    await expect(page.locator('[name="plain"]')).toHaveValue('Retained edit')
    expect(await page.evaluate(() => window.fixture.emissions)).toBe(emissions)
    expect(errors).toEqual([])
  })

test('I18N: regional messages and partial custom overrides share the application catalog', async ({
  page,
  open,
}) => {
  await open('fields', { language: 'de-DE', catalog: 'override' })
  await expect(page.getByRole('textbox', { name: 'Vorname', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Antrag abschicken', exact: true })).toBeVisible()
  await expect(page.getByText(required.de, { exact: true }).first()).toBeVisible()
})

test('I18N: the packed blank template deliberately suppresses system text', async ({
  page,
  open,
}) => {
  await open('fields', { language: 'de', catalog: 'template' })
  await expect(page.locator('button[type="submit"]')).toHaveText('')
  await expect(page.getByText(required.de, { exact: true })).toHaveCount(0)
  await expect(page.getByText(english.tg_validation_required, { exact: true })).toHaveCount(0)
  await expect(page.locator('[name="plain"]')).toBeVisible()
})
