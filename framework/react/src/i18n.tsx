import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  createTranslator,
  loadTranslations,
  safeLocale,
  type I18nConfig,
  type MessageParameters,
  type TranslationCatalog,
  type TungstenText,
} from '../../../api/src/i18n.js'
import type { TungstenConfig } from '../../../api/src/http.js'
import { loadBundledTranslations } from '../../../api/src/locales.js'

const defaultLanguage = {
  language: 'en',
  t: createTranslator(),
  loading: false,
  error: null as unknown,
  reload: () => undefined as void,
}
const LanguageContext = createContext(defaultLanguage)
export function useTungstenLang() {
  return useContext(LanguageContext)
}
export function TungstenLang({
  children,
  params,
}: {
  children: TungstenText
  params?: MessageParameters
}) {
  return <>{useTungstenLang().t(children, params)}</>
}
export function TungstenLanguageProvider({
  language = 'en',
  config,
  transport = {},
  inherit = false,
  children,
}: PropsWithChildren<{
  language?: string
  config?: I18nConfig
  transport?: TungstenConfig
  inherit?: boolean
}>) {
  const parent = useTungstenLang()
  const request = transport.request
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState<{
    language: string
    catalog?: TranslationCatalog
    fallback?: TranslationCatalog
  }>({ language: 'en' })
  const [status, setStatus] = useState({ loading: false, error: null as unknown })
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    if (inherit) return
    const controller = new AbortController()
    let active = true
    const fallbackLanguage = config?.fallbackLanguage ?? 'en'
    void Promise.resolve().then(async () => {
      if (!active) return
      setStatus({ loading: true, error: null })
      const result = await Promise.allSettled([
        loadTranslations(language, config, { request }, controller.signal),
        language === fallbackLanguage
          ? Promise.resolve(undefined)
          : loadTranslations(fallbackLanguage, config, { request }, controller.signal),
        loadBundledTranslations(language),
        language === fallbackLanguage
          ? Promise.resolve(undefined)
          : loadBundledTranslations(fallbackLanguage),
      ])
      if (!active) return
      const custom = result[0].status === 'fulfilled' ? result[0].value : undefined
      const customFallback = result[1].status === 'fulfilled' ? result[1].value : undefined
      const bundled = result[2].status === 'fulfilled' ? result[2].value : undefined
      const bundledFallback = result[3].status === 'fulfilled' ? result[3].value : undefined
      const catalog = { ...bundled, ...custom }
      const fallback = { ...bundledFallback, ...customFallback }
      setLoaded({ language, catalog, fallback })
      setStatus({
        loading: false,
        error: result.find((value) => value.status === 'rejected')?.reason ?? null,
      })
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [language, config, request, revision, inherit])
  const value = useMemo(
    () => ({
      language: safeLocale(loaded.language),
      t: createTranslator(loaded.language, loaded.catalog, loaded.fallback),
      ...status,
      reload,
    }),
    [loaded, status, reload],
  )
  return (
    <LanguageContext.Provider value={inherit ? parent : value}>{children}</LanguageContext.Provider>
  )
}
