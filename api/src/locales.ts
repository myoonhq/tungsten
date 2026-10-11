import english from './locales/en.json'
import languages from './locales/languages.json'
import { safeLocale, type TranslationCatalog } from './i18n.js'

const loaders = {
  en: async () => english,
  sk: async () => (await import('./locales/sk.json')).default,
  hu: async () => (await import('./locales/hu.json')).default,
  de: async () => (await import('./locales/de.json')).default,
  es: async () => (await import('./locales/es.json')).default,
  fr: async () => (await import('./locales/fr.json')).default,
}

/** Complete built-in message catalogs. Regional variants use their base language. */
export const supportedLanguages = Object.freeze(languages)

export async function loadBundledTranslations(
  language: string,
): Promise<TranslationCatalog | undefined> {
  const locale = safeLocale(language)
  const base = locale.split('-')[0]
  return Object.hasOwn(loaders, base) ? loaders[base as keyof typeof loaders]() : undefined
}
