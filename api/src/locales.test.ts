import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import english from './locales/en.json'
import template from './locales/template.json'
import reference from './locales/reference.json'
import { checkCatalog, createTranslator } from './i18n.js'
import { loadBundledTranslations, supportedLanguages } from './locales.js'

const parameters = (value: string) =>
  [...new Set([...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]))].sort()

describe('shipped Tungsten languages', () => {
  for (const language of Object.keys(supportedLanguages)) {
    it(`loads the complete ${language} catalog with valid interpolation and plurals`, async () => {
      const catalog = checkCatalog(await loadBundledTranslations(language))
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort())
      const raw = JSON.parse(readFileSync(`api/src/locales/${language}.json`, 'utf8'))
      expect(catalog).toEqual(raw)
      const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories
      for (const [key, source] of Object.entries(english)) {
        const target = catalog[key]
        if (typeof source === 'string') expect(target, key).toBeTypeOf('string')
        else {
          expect(target, key).toBeTypeOf('object')
          for (const category of categories) expect(target, key).toHaveProperty(category)
        }
        const values = typeof target === 'string' ? [target] : Object.values(target)
        for (const value of values) {
          expect(value.trim(), key).not.toBe('')
          expect(parameters(value), key).toEqual(
            parameters(typeof source === 'string' ? source : source.other),
          )
        }
        // Resolve every key, not just a representative button.
        const params = Object.fromEntries(
          reference
            .find((entry) => entry.key === key)!
            .parameters.map((name) => [name, name === 'count' ? 3 : `test-${name}`]),
        )
        expect(createTranslator(language, catalog)(key, params), key).not.toContain('{')
      }
    })
  }
  it('recognizes regional tags without requiring duplicate catalogs', async () => {
    expect(await loadBundledTranslations('de-DE')).toEqual(await loadBundledTranslations('DE'))
    expect(await loadBundledTranslations('fr-CA')).toEqual(await loadBundledTranslations('fr'))
    expect(await loadBundledTranslations('es-MX')).toEqual(await loadBundledTranslations('es'))
    expect(await loadBundledTranslations('xx')).toBeUndefined()
    expect(await loadBundledTranslations('toString')).toBeUndefined()
  })
  it('keeps the blank template intentional and documents every system key and parameter', () => {
    expect(Object.keys(template).sort()).toEqual(Object.keys(english).sort())
    expect(Object.values(template).every((value) => value === '')).toBe(true)
    expect(reference.map((entry) => entry.key).sort()).toEqual(Object.keys(english).sort())
    for (const entry of reference) {
      expect(entry.area).toBeTruthy()
      expect(entry.purpose).toBeTruthy()
      expect(entry.default).toEqual(english[entry.key as keyof typeof english])
      expect(entry.parameters).toEqual(
        parameters(typeof entry.default === 'string' ? entry.default : entry.default.other),
      )
    }
    const t = createTranslator('en', checkCatalog(template))
    for (const key of Object.keys(english)) expect(t(key)).toBe('')
  })
  it('keeps installed catalogs, the advertised inventory and documentation language list consistent', () => {
    const files = readdirSync('api/src/locales')
      .filter((name) => !['languages.json', 'template.json', 'reference.json'].includes(name))
      .map((name) => name.replace(/\.json$/, ''))
      .sort()
    expect(files).toEqual(Object.keys(supportedLanguages).sort())
    const documentation = readFileSync('docs/I18N.md', 'utf8')
    const documented = [...documentation.matchAll(/\| `([a-z]+)` \|/g)]
      .map((match) => match[1])
      .sort()
    expect(documented).toEqual(Object.keys(supportedLanguages).sort())
  })
  it('falls back to English for unsupported languages', async () => {
    expect(await loadBundledTranslations('he')).toBeUndefined()
    expect(createTranslator('he')('tg_ui_submit')).toBe('Submit')
  })
})
