import { describe, expect, it, vi } from 'vitest'
import {
  checkCatalog,
  createTranslator,
  loadTranslations,
  messageOf,
  TungstenMessageError,
  type TungstenMessage,
} from './i18n.js'
import { ApiError } from './http.js'

describe('translation contract', () => {
  it('looks up schema strings, with literal/missing-key and bundled English fallback', () => {
    const t = createTranslator(
      'sk',
      { 'contact.name': 'Meno', 'Your name': 'Vaše meno' },
      { fallback: 'Fallback' },
    )
    expect(t('contact.name')).toBe('Meno')
    expect(t('Your name')).toBe('Vaše meno')
    expect(t('Literal label')).toBe('Literal label')
    expect(t('missing.key')).toBe('missing.key')
    expect(t('fallback')).toBe('Fallback')
    expect(t('tg_ui_submit')).toBe('Submit')
    expect(t(undefined)).toBeUndefined()
    const literalJSON = '{"messageKey":"tg_ui_submit"}'
    expect(t(literalJSON)).toBe(literalJSON)
  })
  it('interpolates core parameters, nested labels, and locale-specific plural forms without interpreting markup', () => {
    const t = createTranslator('sk', {
      items: { one: '{count} položka', few: '{count} položky', other: '{count} položiek' },
      greeting: 'Dobrý deň, {name}',
      label: 'Mená',
      wrapped: '{label}: {value}',
    })
    expect(t('items', { count: 1 })).toBe('1 položka')
    expect(t('items', { count: 3 })).toBe('3 položky')
    expect(t('items', { count: 8 })).toBe('8 položiek')
    expect(t({ messageKey: 'tg_validation_min_length', params: { min: 5 } })).toBe(
      'Must contain at least 5 characters.',
    )
    expect(t('wrapped', { label: { messageKey: 'label' }, value: 'label' })).toBe('Mená: label')
    expect(t('greeting', { name: '<img src=x onerror=alert(1)>' })).toContain('<img src=x')
    expect(t('greeting')).toBe('Dobrý deň, {name}')
    const cycle: TungstenMessage = { messageKey: 'wrapped' }
    cycle.params = { label: cycle, value: '' }
    expect(t(cycle)).toContain('wrapped')
  })
  it('does not resolve inherited properties and rejects malformed catalogs', () => {
    expect(createTranslator('en')('toString')).toBe('toString')
    expect(createTranslator('not a locale')('tg_ui_submit')).toBe('Submit')
    for (const value of [
      null,
      [],
      { key: 4 },
      { key: { one: 'one' } },
      { key: { other: 'other', bad: 'bad' } },
    ])
      expect(() => checkCatalog(value)).toThrow('tg_i18n_invalid_catalog')
    expect(checkCatalog({ key: '', count: { one: 'one', other: 'other' } })).toBeTruthy()
  })
  it('keeps error keys, parameters and HTTP status across JS/worker boundaries', () => {
    const error = new ApiError('tg_api_http_error', 'tg_api_http_error', 503)
    expect(messageOf(error)).toEqual({ messageKey: 'tg_api_http_error', params: { status: 503 } })
    expect(
      messageOf(new TungstenMessageError({ messageKey: 'tg_validation_min', params: { min: 3 } })),
    ).toEqual({ messageKey: 'tg_validation_min', params: { min: 3 } })
    expect(
      messageOf(JSON.stringify({ messageKey: 'tg_schema_example', params: { key: 'name' } })),
    ).toEqual({ messageKey: 'tg_schema_example', params: { key: 'name' } })
    expect(messageOf(new Error('Host-owned message'))).toBe('Host-owned message')
  })
  it('loads JSON through the shared executor without application credentials', async () => {
    const request = vi.fn(async () => ({ data: { greeting: 'Ahoj' } }))
    const config = { translations: { sk: '/translations/sk.json' } }
    expect(
      await loadTranslations(
        'sk',
        config,
        {
          apis: {
            private: { baseUrl: 'https://private.invalid/', headers: { Authorization: 'secret' } },
          },
          request,
        },
        new AbortController().signal,
      ),
    ).toEqual({ greeting: 'Ahoj' })
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('/translations/sk.json'),
        credentials: 'omit',
        context: { operation: 'i18n', key: 'sk' },
      }),
    )
    expect(request.mock.calls[0][0].headers.has('Authorization')).toBe(false)
    request.mockClear()
    expect(
      await loadTranslations(
        'en',
        { translations: { en: { greeting: 'Hello' } } },
        { request },
        new AbortController().signal,
      ),
    ).toEqual({ greeting: 'Hello' })
    expect(request).not.toHaveBeenCalled()
  })
  it('cancels an abort-ignoring translation executor', async () => {
    const controller = new AbortController()
    const request = vi.fn(() => new Promise<never>(() => undefined))
    const work = loadTranslations('sk', { directory: '/lang/' }, { request }, controller.signal)
    const rejected = expect(work).rejects.toBeDefined()
    await Promise.resolve()
    controller.abort()
    await rejected
    expect(request.mock.calls[0][0].signal.aborted).toBe(true)
  })
})
