import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TungstenLang, TungstenLanguageProvider, useTungstenLang } from './i18n.js'
import type { ApiRequest } from '../../../api/src/http.js'
import { supportedLanguages } from '../../../api/src/locales.js'
import english from '../../../api/src/locales/en.json'
import template from '../../../api/src/locales/template.json'
function Probe() {
  const { loading, error, reload, t, language } = useTungstenLang()
  return (
    <div lang={language}>
      <p>
        <TungstenLang>greeting</TungstenLang>
      </p>
      <p>
        <TungstenLang>tg_ui_submit</TungstenLang>
      </p>
      <input aria-label={t('greeting')} placeholder={t('placeholder')} />
      <output>{loading ? 'loading' : error ? 'error' : 'ready'}</output>
      <button onClick={reload}>Reload language</button>
    </div>
  )
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}
describe('per-instance language provider', () => {
  for (const language of Object.keys(supportedLanguages))
    it(`automatically loads every ${language} system message without host translations`, async () => {
      const request = vi.fn()
      function AllMessages() {
        const { t, loading } = useTungstenLang()
        return (
          <section aria-label="Messages">
            <output>{loading ? 'loading' : 'ready'}</output>
            {Object.keys(english).map((key) => (
              <span data-testid={key} key={key}>
                {t(key)}
              </span>
            ))}
          </section>
        )
      }
      render(
        <TungstenLanguageProvider language={language} transport={{ request }}>
          <AllMessages />
        </TungstenLanguageProvider>,
      )
      const catalog = (await import(`../../../api/src/locales/${language}.json`)).default
      await waitFor(() =>
        expect(screen.getByTestId('tg_ui_submit')).toHaveTextContent(catalog.tg_ui_submit),
      )
      expect(screen.getByText('ready')).toBeInTheDocument()
      const rendered = Object.fromEntries(
        [...screen.getByRole('region', { name: 'Messages' }).querySelectorAll('[data-testid]')].map(
          (element) => [element.getAttribute('data-testid'), element.textContent],
        ),
      )
      expect(rendered).toEqual(
        Object.fromEntries(
          Object.entries(catalog).map(([key, entry]) => [
            key,
            typeof entry === 'string' ? entry : (entry as { other: string }).other,
          ]),
        ),
      )
      expect(request).not.toHaveBeenCalled()
    })
  it('uses one partial catalog for application labels and system overrides, preserving empty strings', async () => {
    const config = { translations: { 'de-DE': { greeting: 'Vorname', tg_ui_submit: '' } } }
    function Messages() {
      const { t } = useTungstenLang()
      return (
        <>
          <Probe />
          <p>{t('tg_validation_required')}</p>
        </>
      )
    }
    render(
      <TungstenLanguageProvider language="de-DE" config={config}>
        <Messages />
      </TungstenLanguageProvider>,
    )
    await screen.findByLabelText('Vorname')
    expect(screen.getByText('Dieses Feld ist erforderlich.')).toBeInTheDocument()
    expect(screen.queryByText('Absenden')).toBeNull()
    expect(screen.queryByText('Submit')).toBeNull()
  })
  it('uses custom keys for an unsupported language and the configured fallback for missing messages', async () => {
    const config = {
      translations: { cs: { greeting: 'Jméno' }, de: { tg_ui_submit: 'Senden' } },
      fallbackLanguage: 'de',
    }
    render(
      <TungstenLanguageProvider language="cs" config={config}>
        <Probe />
      </TungstenLanguageProvider>,
    )
    await screen.findByText('Jméno')
    expect(screen.getByText('Senden')).toBeInTheDocument()
  })
  it('gives the active bundled language precedence over the custom fallback language', async () => {
    render(
      <TungstenLanguageProvider
        language="de"
        config={{ translations: { en: { tg_ui_submit: 'Send override' } } }}
      >
        <Probe />
      </TungstenLanguageProvider>,
    )
    await screen.findByText('Absenden')
    expect(screen.queryByText('Send override')).toBeNull()
  })
  it('treats every unedited template value as an intentional empty override', async () => {
    function Messages() {
      const { t, loading } = useTungstenLang()
      return (
        <section aria-label="Blank messages">
          <output>{loading ? 'loading' : 'ready'}</output>
          {Object.keys(template).map((key) => (
            <span key={key}>{t(key)}</span>
          ))}
        </section>
      )
    }
    render(
      <TungstenLanguageProvider language="de" config={{ translations: { de: template } }}>
        <Messages />
      </TungstenLanguageProvider>,
    )
    await waitFor(() =>
      expect(
        [...screen.getByRole('region').querySelectorAll('span')].every(
          (element) => element.textContent === '',
        ),
      ).toBe(true),
    )
    expect(within(screen.getByRole('region')).getByText('ready')).toBeInTheDocument()
  })
  it('falls back to bundled English when an unsupported language has no custom catalog', async () => {
    render(
      <TungstenLanguageProvider language="cs">
        <Probe />
      </TungstenLanguageProvider>,
    )
    await screen.findByText('ready')
    expect(screen.getByText('Submit')).toBeInTheDocument()
    expect(screen.getByText('greeting')).toBeInTheDocument()
  })
  it('isolates simultaneous forms and escapes translated content', async () => {
    const config = {
      translations: {
        en: { greeting: 'Hello', placeholder: 'Name' },
        sk: { greeting: 'Ahoj <b>world</b>', placeholder: 'Meno' },
      },
    }
    render(
      <>
        <TungstenLanguageProvider language="en" config={config}>
          <Probe />
        </TungstenLanguageProvider>
        <TungstenLanguageProvider language="sk" config={config}>
          <Probe />
        </TungstenLanguageProvider>
      </>,
    )
    expect(await screen.findByText('Hello')).toBeInTheDocument()
    expect(await screen.findByText('Ahoj <b>world</b>')).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
    expect(screen.getByLabelText('Hello')).toHaveAttribute('placeholder', 'Name')
    expect(screen.getByLabelText('Ahoj <b>world</b>')).toHaveAttribute('placeholder', 'Meno')
  })
  it('keeps the active language while loading and ignores an obsolete completion', async () => {
    const slow = deferred<{ data: unknown }>()
    let abandoned: AbortSignal | undefined
    const request = vi.fn((req: ApiRequest) => {
      abandoned = req.signal
      return slow.promise
    })
    const config = {
      translations: { en: { greeting: 'Hello' }, sk: '/lang/sk.json', de: { greeting: 'Hallo' } },
    }
    const transport = { request }
    const view = render(
      <TungstenLanguageProvider config={config} transport={transport}>
        <Probe />
      </TungstenLanguageProvider>,
    )
    await screen.findByText('Hello')
    view.rerender(
      <TungstenLanguageProvider language="sk" config={config} transport={transport}>
        <Probe />
      </TungstenLanguageProvider>,
    )
    await screen.findByText('loading')
    expect(screen.getByText('Hello')).toBeInTheDocument()
    view.rerender(
      <TungstenLanguageProvider language="de" config={config} transport={transport}>
        <Probe />
      </TungstenLanguageProvider>,
    )
    await screen.findByText('Hallo')
    expect(abandoned?.aborted).toBe(true)
    await act(async () => slow.resolve({ data: { greeting: 'Stale' } }))
    expect(screen.getByText('Hallo')).toBeInTheDocument()
    expect(screen.queryByText('Stale')).toBeNull()
  })
  it('falls back on failure, exposes the error, and reloads explicitly', async () => {
    const request = vi.fn(async () => {
      if (request.mock.calls.length === 1) throw new Error('Offline')
      return { data: { greeting: 'Recovered', tg_ui_submit: 'Send' } }
    })
    const config = { translations: { sk: '/lang/sk.json' } }
    render(
      <TungstenLanguageProvider language="sk" config={config} transport={{ request }}>
        <Probe />
      </TungstenLanguageProvider>,
    )
    await screen.findByText('error')
    expect(screen.getByText('Odoslať')).toBeInTheDocument()
    expect(screen.getByText('greeting')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload language' }))
    await screen.findByText('Recovered')
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())
    expect(screen.getByText('Send')).toBeInTheDocument()
  })
})
