import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState } from 'react'
import {
  Tungsten,
  TungstenEditor,
  TungstenThemeProvider,
  type TungstenColorScheme,
  type TungstenController,
  type TungstenSnapshot,
  type TungstenValues,
  type FieldRendererProps,
  type TungstenDiagnostic,
} from '@myoon/tungsten/react'
import { designs } from './designs.js'
import { scenario } from './scenarios.js'
import template from '@myoon/tungsten/locales/template.json'

const params = new URLSearchParams(location.search)
const session = params.get('session') ?? 'manual'
const name = params.get('scenario') ?? 'fields'
const selected = params.get('design') ?? 'tungsten'
const base = designs[selected]
if (!base) throw new Error(`Unimplemented design: ${selected}`)
const counters: Record<string, number> = {}
const design = name.startsWith('benchmark')
  ? {
      ...base,
      fields: Object.fromEntries(
        Object.entries(base.fields).map(([type, Renderer]) => [
          type,
          function Counted(props: FieldRendererProps) {
            counters[props.field.key] = (counters[props.field.key] ?? 0) + 1
            return <Renderer {...props} />
          },
        ]),
      ),
    }
  : base
const schema = scenario(
  name,
  Number(params.get('count') ?? 10),
  Number(params.get('mounted') ?? 100),
  Number(params.get('affected') ?? 1),
)
const initialValues: TungstenValues | undefined = params.has('draft')
  ? (JSON.parse(params.get('draft')!) as TungstenValues)
  : name === 'benchmark-line-items'
    ? {
        items: Array.from({ length: Number(params.get('count') ?? 40) / 4 }, (_, index) => ({
          name: `item-${index}`,
          quantity: 1,
          price: 10,
          category: 'goods',
        })),
      }
    : name === 'benchmark-repeater'
      ? {
          people: Array.from({ length: Number(params.get('count') ?? 100) / 10 }, (_, index) => ({
            name: `person-${index}`,
            active: false,
            children: Array.from({ length: 2 }, (_, child) => ({
              name: `child-${index}-${child}`,
              amount: 1,
              active: false,
              choice: 'a',
            })),
          })),
        }
      : undefined
const fixture = {
  startedAt: performance.now(),
  readyAt: 0,
  snapshotAt: 0,
  notifications: new Set<() => void>(),
  waitFor(predicate: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fixture.notifications.delete(notify)
        reject(new Error('Fixture did not settle'))
      }, 10000)
      const notify = () => {
        if (predicate()) {
          clearTimeout(timer)
          fixture.notifications.delete(notify)
          resolve()
        }
      }
      fixture.notifications.add(notify)
      notify()
    })
  },
  mount: (mounted: boolean): void => {
    throw new Error(`Fixture mount controller unavailable: ${mounted}`)
  },
  setColorScheme: (scheme: TungstenColorScheme): void => {
    throw new Error(`Fixture theme controller unavailable: ${scheme}`)
  },
  setColorProfile: (profile: string): void => {
    throw new Error(`Fixture profile controller unavailable: ${profile}`)
  },
  saves: [] as { values: TungstenValues; at: number }[],
  snapshot: null as TungstenSnapshot | null,
  controller: null as TungstenController | null,
  submissions: [] as TungstenValues[],
  renders: counters,
  emissions: 0,
  diagnostics: [] as TungstenDiagnostic[],
}
declare global {
  interface Window {
    fixture: typeof fixture
  }
}
window.fixture = fixture

function App() {
  const [colorProfile, setColorProfile] = useState(params.get('colorProfile') ?? 'sprout')
  useEffect(() => {
    fixture.setColorProfile = setColorProfile
  }, [])
  const [colorScheme, setColorScheme] = useState<TungstenColorScheme>(
    (params.get('theme') ?? params.get('colorScheme')) === 'dark' ? 'dark' : 'light',
  )
  useEffect(() => {
    fixture.setColorScheme = setColorScheme
  }, [])
  const [language, setLanguage] = useState(params.get('language') ?? 'en')
  const [mounted, setMounted] = useState(true)
  useEffect(() => {
    fixture.mount = (next) => {
      if (!next) {
        fixture.snapshot = null
        fixture.controller = null
      }
      setMounted(next)
    }
  }, [])
  const [submitted, setSubmitted] = useState<TungstenValues | null>(null)
  const config = useMemo(
    () => ({
      maxProcessingSteps: params.has('limit') ? Number(params.get('limit')) : 100,
      warnings: 'silent' as const,
      autosave: params.has('autosave') ? { debounceMs: 200 } : undefined,
      apis: { test: { baseUrl: `${location.origin}/api/${session}/` } },
      i18n: {
        translations:
          params.get('catalog') === 'template'
            ? { [params.get('language') ?? 'en']: template }
            : params.get('catalog') === 'override'
              ? {
                  [params.get('language') ?? 'en']: {
                    plain: 'Vorname',
                    tg_ui_submit: 'Antrag abschicken',
                  },
                }
              : {
                  sk: {
                    plain: 'Text',
                    tg_ui_submit: 'Odoslať',
                    ...(name === 'benchmark-language'
                      ? Object.fromEntries(
                          Array.from({ length: Number(params.get('count') ?? 10) }, (_, index) => [
                            `field_${index}`,
                            `Pole ${index}`,
                          ]),
                        )
                      : {}),
                  },
                },
      },
    }),
    [],
  )
  const sources = useMemo(
    () => ({
      largeOptions: {
        api: 'test',
        endpoint: 'options',
        resultPath: '/data',
        schema: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: { value: { type: 'string' as const }, label: { type: 'string' as const } },
            required: ['value', 'label'],
            additionalProperties: false,
          },
        },
      },
      regions: {
        api: 'test',
        endpoint: 'regions',
        resultPath: '/data',
        schema: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: { value: { type: 'string' as const }, label: { type: 'string' as const } },
            required: ['value', 'label'],
            additionalProperties: false,
          },
        },
      },
    }),
    [],
  )
  return (
    <main style={{ maxWidth: 640, margin: '24px auto', padding: 16 }}>
      <button
        type="button"
        onClick={() => setLanguage((current) => (current === 'en' ? 'sk' : 'en'))}
      >
        Change language
      </button>
      {params.has('i18n') ? (
        <label>
          Fixture language
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {['en', 'sk', 'hu', 'de', 'es', 'fr', 'de-DE', 'cs'].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      ) : null}
      {params.has('theme') ? (
        <label>
          Fixture color scheme
          <select
            value={colorScheme}
            onChange={(event) => setColorScheme(event.target.value as TungstenColorScheme)}
          >
            <option>light</option>
            <option>dark</option>
          </select>
        </label>
      ) : null}
      <TungstenThemeProvider colorScheme={colorScheme} colorProfile={colorProfile}>
        {params.has('editor') ? (
          <TungstenEditor initialSchema={schema} design={design} />
        ) : mounted ? (
          <Tungsten
            schema={schema}
            design={design}
            initialValues={initialValues}
            config={config}
            dataSources={sources}
            language={language}
            onDiagnostic={(diagnostic) => {
              fixture.diagnostics.push(diagnostic)
            }}
            onReady={(controller) => {
              fixture.controller = controller
              if (params.get('observe') === 'none') fixture.readyAt ||= performance.now()
            }}
            onStateChange={
              params.get('observe') === 'none'
                ? undefined
                : (snapshot) => {
                    fixture.snapshot = snapshot
                    fixture.emissions++
                    fixture.snapshotAt = performance.now()
                    fixture.readyAt ||= fixture.snapshotAt
                    for (const notify of fixture.notifications) notify()
                  }
            }
            onSave={
              params.has('autosave')
                ? async (values) => {
                    fixture.saves.push({ values, at: performance.now() })
                    for (const notify of fixture.notifications) notify()
                  }
                : undefined
            }
            onSubmit={async (values) => {
              const response = await fetch(`/api/${session}/submit`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(values),
              })
              if (!response.ok) throw new Error(`Fixture submit HTTP ${response.status}`)
              fixture.submissions.push(values)
              for (const notify of fixture.notifications) notify()
              setSubmitted(values)
            }}
          />
        ) : null}
        {params.has('sibling') ? (
          <Tungsten schema={scenario('date-locale')} design={design} colorScheme="light" />
        ) : null}
      </TungstenThemeProvider>
      <button
        type="button"
        onClick={() => {
          void fixture.controller?.reset()
        }}
      >
        Reset form
      </button>
      {submitted ? (
        <output aria-label="Submitted values">{JSON.stringify(submitted)}</output>
      ) : null}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
