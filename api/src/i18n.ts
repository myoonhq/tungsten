import bundledEnglish from './locales/en.json'
import { ApiClient, type TungstenConfig } from './http.js'

export type MessageParameters = Readonly<
  Record<string, string | number | boolean | null | TungstenMessage>
>
export type TungstenMessage = { messageKey: string; params?: MessageParameters }
export type TungstenText = string | TungstenMessage
export type TranslationEntry =
  | string
  | (Partial<Record<Intl.LDMLPluralRule, string>> & { other: string })
export type TranslationCatalog = Readonly<Record<string, TranslationEntry>>
export type I18nConfig = {
  /** Imported JSON objects or browser-accessible JSON file URLs, indexed by language. */
  translations?: Readonly<Record<string, TranslationCatalog | string>>
  /** Browser-accessible directory containing <language>.json files. */
  directory?: string
  fallbackLanguage?: string
}
export const englishTranslations: TranslationCatalog = bundledEnglish
const own = (catalog: TranslationCatalog | undefined, key: string) =>
  catalog && Object.hasOwn(catalog, key) ? catalog[key] : undefined
export function checkCatalog(value: unknown): TranslationCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('tg_i18n_invalid_catalog')
  for (const entry of Object.values(value)) {
    if (typeof entry === 'string') continue
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.other !== 'string' ||
      Object.entries(entry).some(
        ([key, text]) =>
          !['zero', 'one', 'two', 'few', 'many', 'other'].includes(key) || typeof text !== 'string',
      )
    )
      throw new Error('tg_i18n_invalid_catalog')
  }
  return value as TranslationCatalog
}
export function messageOf(error: unknown): TungstenText {
  if (
    error &&
    typeof error === 'object' &&
    'messageKey' in error &&
    typeof error.messageKey === 'string'
  ) {
    const object = error as TungstenMessage & { status?: number }
    return {
      messageKey: object.messageKey,
      params:
        object.params ?? (object.status === undefined ? undefined : { status: object.status }),
    }
  }
  const text = error instanceof Error ? error.message : String(error)
  try {
    const value = JSON.parse(text)
    if (value && typeof value.messageKey === 'string' && value.messageKey.startsWith('tg_'))
      return value as TungstenMessage
  } catch {
    /* External/literal errors remain text. */
  }
  return text
}
export class TungstenMessageError extends Error {
  readonly messageKey: string
  readonly params?: MessageParameters
  constructor(message: TungstenMessage) {
    super(JSON.stringify(message))
    this.messageKey = message.messageKey
    this.params = message.params
  }
}
export function createTranslator(
  language = 'en',
  catalog?: TranslationCatalog,
  fallback?: TranslationCatalog,
) {
  const locale = safeLocale(language)
  const plural = new Intl.PluralRules(locale)
  function translate(text: TungstenText, parameters?: MessageParameters): string
  function translate(text: undefined, parameters?: MessageParameters): undefined
  function translate(
    text: TungstenText | undefined,
    parameters?: MessageParameters,
  ): string | undefined
  function translate(
    text: TungstenText | undefined,
    parameters: MessageParameters = {},
  ): string | undefined {
    return render(text, parameters, 0)
  }
  function render(
    text: TungstenText | undefined,
    parameters: MessageParameters,
    depth: number,
  ): string | undefined {
    if (text === undefined) return undefined
    const key = typeof text === 'string' ? text : text.messageKey
    if (depth > 32) return key
    const params = typeof text === 'string' ? parameters : { ...text.params, ...parameters }
    const entry = own(catalog, key) ?? own(fallback, key) ?? own(englishTranslations, key)
    const count = params.count
    const template =
      typeof entry === 'string'
        ? entry
        : entry
          ? (entry[typeof count === 'number' ? plural.select(count) : 'other'] ?? entry.other)
          : key
    return template.replace(/\{([a-zA-Z][\w]*)\}/g, (match, name: string) => {
      const value = params[name]
      if (value === undefined) return match
      return typeof value === 'object' && value !== null
        ? (render(value, {}, depth + 1) ?? match)
        : String(value ?? '')
    })
  }
  return translate
}
export function safeLocale(language: string): string {
  try {
    return Intl.getCanonicalLocales(language)[0] ?? 'en'
  } catch {
    return 'en'
  }
}
export async function loadTranslations(
  language: string,
  config: I18nConfig | undefined,
  transport: TungstenConfig,
  signal: AbortSignal,
): Promise<TranslationCatalog | undefined> {
  const entry =
    config?.translations && Object.hasOwn(config.translations, language)
      ? config.translations[language]
      : undefined
  if (entry && typeof entry !== 'string') return checkCatalog(entry)
  const path =
    typeof entry === 'string'
      ? entry
      : config?.directory
        ? `${config.directory.replace(/\/$/, '')}/${encodeURIComponent(language)}.json`
        : undefined
  if (!path) return undefined
  const url = new URL(path, typeof location === 'undefined' ? 'http://localhost/' : location.href)
  // Static catalog requests use the shared executor/timeout/cancellation path, without inheriting application API credentials.
  const client = new ApiClient({
    request: transport.request,
    apis: { translations: { baseUrl: `${url.origin}/` } },
  })
  return checkCatalog(
    await client.request(
      { api: 'translations', endpoint: `${url.pathname.slice(1)}${url.search}` },
      { operation: 'i18n', key: language },
      { signal },
    ),
  )
}
