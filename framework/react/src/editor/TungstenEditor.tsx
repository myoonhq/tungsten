import { messageOf, type TungstenText } from '../../../../api/src/i18n.js'
import { TungstenLang, TungstenLanguageProvider, useTungstenLang } from '../i18n.js'
import {
  TungstenThemeProvider,
  useTungstenColorScheme,
  useTungstenColorProfile,
  type TungstenColorScheme,
  type TungstenColorProfile,
} from '../theme.js'
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react'
import { EngineClient } from '../../../../api/src/engine/client.js'
import { fieldTypeOf, isGroup, isRepeater } from '../../../../api/src/types.js'
import { Tungsten } from '../Tungsten.js'
import type {
  AuthoringCatalog,
  TungstenComponent,
  TungstenDesign,
  TungstenSchema,
  TungstenSnapshot,
  TungstenValues,
} from '../types.js'
import { editorDesign } from './design.js'
import { TungstenTextField } from '../../../../design/tungsten/src/index.js'
import { arrange, type DropLocation, type EditorDrag } from './arrangement.js'
import { EditorCanvas, EDITOR_DRAG_MIME, type DragHandlers } from './canvas.js'
import { initialValuesTemplate } from './initial-values.js'
import {
  applyInspector,
  childrenOf,
  componentAt,
  emptySchema,
  inspector,
  parseSchema,
  replaceAt,
  type ComponentPath,
} from './model.js'

export type TungstenEditorProps = {
  colorScheme?: TungstenColorScheme
  colorProfile?: TungstenColorProfile
  language?: string
  initialSchema?: TungstenSchema
  initialValues?: TungstenValues | null
  /** Optional metadata snapshot matching the installed WASM registry. */
  catalog?: AuthoringCatalog
  design?: TungstenDesign
  config?: import('../../../../api/src/http.js').TungstenConfig
  dataSources?: import('../../../../api/src/data-sources.js').DataSources
  onChange?: (schema: TungstenSchema) => void
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2)
const message = messageOf

function JSONInput({
  inputId,
  label,
  value,
  onChange,
}: {
  inputId: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="tg-root">
      <TungstenTextField
        inputId={inputId}
        field={{
          type: 'text',
          key: inputId,
          textarea: true,
          rows: 10,
          view: { label, format: 'json' },
        }}
        state={{ value, hidden: false, errors: [] }}
        required={false}
        disabled={false}
        readOnly={false}
        onValueChange={(next) => onChange(String(next ?? ''))}
      />
    </div>
  )
}

function Outline({
  components,
  path = [],
  selection,
  pending,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  components: readonly TungstenComponent[]
  path?: ComponentPath
  selection: ComponentPath
  pending: boolean
  onSelect: (path: ComponentPath) => void
} & DragHandlers) {
  return (
    <ul className="te-outline">
      {components.map((component, index) => {
        const here = [...path, index]
        return (
          <li key={component.key}>
            <button
              type="button"
              aria-pressed={selection.join('.') === here.join('.')}
              onClick={() => onSelect(here)}
              disabled={pending}
              draggable={!pending}
              onDragStart={(event) => onDragStart(event, { kind: 'component', path: here })}
              onDragEnd={onDragEnd}
            >
              <span className="te-node-icon" aria-hidden="true">
                <TungstenLang>
                  {isGroup(component) ? '▤' : isRepeater(component) ? '⊞' : '·'}
                </TungstenLang>
              </span>
              <span>
                <strong>
                  <TungstenLang>{component.view?.label || component.key}</TungstenLang>
                </strong>
                <small>{component.key}</small>
              </span>
              <span className="te-node-type">
                <TungstenLang>{fieldTypeOf(component)}</TungstenLang>
              </span>
            </button>
            {childrenOf(component).length > 0 ? (
              <Outline
                components={childrenOf(component)}
                path={here}
                selection={selection}
                pending={pending}
                onSelect={onSelect}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

const inspectorConfig = { maxProcessingSteps: 1000 }
const emptyEditorConfig: import('../../../../api/src/http.js').TungstenConfig = {}

export function TungstenEditor(props: TungstenEditorProps) {
  const inherited = useTungstenLang()
  const config = props.config ?? emptyEditorConfig
  const transport = useMemo(
    () => ({
      apis: config.apis,
      request: config.request,
      maxProcessingSteps: config.maxProcessingSteps,
      warnings: config.warnings,
    }),
    [config.apis, config.request, config.maxProcessingSteps, config.warnings],
  )
  const content = <TungstenEditorContent {...props} config={transport} />
  return (
    <TungstenLanguageProvider
      inherit={props.language === undefined && !config.i18n}
      language={props.language ?? inherited.language}
      config={config.i18n}
      transport={transport}
    >
      <TungstenThemeProvider colorScheme={props.colorScheme} colorProfile={props.colorProfile}>
        {content}
      </TungstenThemeProvider>
    </TungstenLanguageProvider>
  )
}

/** The property inspector and recursive component lists are Tungsten forms. */
function TungstenEditorContent({
  initialSchema = emptySchema,
  initialValues = null,
  catalog: suppliedCatalog,
  design,
  config,
  dataSources,
  onChange,
}: TungstenEditorProps) {
  const { t, language } = useTungstenLang()
  const colorScheme = useTungstenColorScheme()
  const colorProfile = useTungstenColorProfile()

  const editorId = useId().replaceAll(':', '')
  const [catalog, setCatalog] = useState<AuthoringCatalog | null>(suppliedCatalog ?? null)
  const [document, setDocument] = useState(initialSchema)
  const [preview, setPreview] = useState<TungstenSchema | null>(null)
  const [selection, setSelection] = useState<ComponentPath>([])
  const [mode, setMode] = useState<'editor' | 'preview' | 'json'>('editor')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = settingsDialog.current
    if (settingsOpen && dialog && !dialog.open) dialog.showModal()
    else if (!settingsOpen && dialog?.open) dialog.close()
  }, [settingsOpen])
  const [json, setJSON] = useState(pretty(initialSchema))
  const [jsonDirty, setJSONDirty] = useState(false)
  const [snapshot, setSnapshot] = useState<TungstenSnapshot | null>(null)
  const [submitted, setSubmitted] = useState<TungstenValues | null>(null)
  const [previewTab, setPreviewTab] = useState('state')
  const [error, setError] = useState<TungstenText | null>(null)
  const [status, setStatus] = useState('tg_editor_loading_core_catalog')
  const [pending, setPending] = useState(true)
  const [history, setHistory] = useState<TungstenSchema[]>([])
  const [future, setFuture] = useState<TungstenSchema[]>([])
  const [previewRevision, setPreviewRevision] = useState(0)
  const [valueJSON, setValueJSON] = useState(() =>
    pretty(initialValuesTemplate(initialSchema, initialValues)),
  )
  const valueJSONDirty = useRef(false)
  const [drag, setDrag] = useState<EditorDrag | null>(null)
  const [loadedValues, setLoadedValues] = useState(initialValues)
  const client = useRef<EngineClient | null>(null)
  const revision = useRef(0)
  const notify = useRef(onChange)
  useEffect(() => {
    notify.current = onChange
  }, [onChange])
  useEffect(() => {
    const engine = new EngineClient()
    client.current = engine
    let active = true
    void (
      suppliedCatalog
        ? Promise.resolve(suppliedCatalog)
        : engine.catalog().then((response) => response.catalog)
    )
      .then((next) => {
        if (active) {
          setCatalog(next)
          setStatus('tg_editor_ready_to_build')
        }
        engine.configure?.(config, dataSources, { fetchSources: false })
        return engine.load(initialSchema, initialValues)
      })
      .then((response) => {
        if (active) {
          setDocument(response.schema)
          setJSON(pretty(response.schema))
          setPreview(response.schema)
          if (!valueJSONDirty.current)
            setValueJSON(pretty(initialValuesTemplate(response.schema, initialValues)))
          setStatus('tg_editor_schema_accepted')
        }
      })
      .catch((error) => {
        if (active) {
          setError(message(error))
          setStatus('tg_editor_draft_needs_attention')
        }
      })
      .finally(() => {
        if (active) setPending(false)
      })
    return () => {
      active = false
      revision.current += 1
      client.current = null
      engine.destroy()
    }
    // initialSchema/initialValues are initialization inputs. Remount to replace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const selected = componentAt(document, selection)
  const settings = useMemo(() => {
    try {
      return { form: catalog ? inspector(selected, document, catalog) : null, error: null }
    } catch (error) {
      return { form: null, error: message(error) }
    }
  }, [catalog, document, selected])

  function apply(
    candidate: TungstenSchema,
    path: ComponentPath = selection,
    remember = true,
    options: { closeSettings?: boolean } = {},
  ) {
    if (!client.current || pending) return
    if (remember) {
      setHistory((history) => [...history.slice(-49), document])
      setFuture([])
    }
    setDocument(candidate)
    setJSON(pretty(candidate))
    setJSONDirty(false)
    setSelection(path)
    if (options.closeSettings) setSettingsOpen(false)
    setError(null)
    setPending(true)
    setStatus('tg_editor_checking_schema')
    const request = ++revision.current
    let resetValues = false
    return client.current
      .load(candidate, loadedValues)
      .catch(async (originalError) => {
        if (loadedValues === null || request !== revision.current || !client.current)
          throw originalError
        try {
          const response = await client.current.load(candidate, null)
          resetValues = true
          return response
        } catch {
          throw originalError
        }
      })
      .then((response) => {
        if (request !== revision.current) return
        setDocument(response.schema)
        setJSON(pretty(response.schema))
        setPreview(response.schema)
        setSnapshot(null)
        setSubmitted(null)
        setStatus(
          resetValues
            ? 'tg_editor_schema_accepted_initial_values_reset'
            : 'tg_editor_schema_accepted',
        )
        if (resetValues) setLoadedValues(null)
        if (!valueJSONDirty.current)
          setValueJSON(
            pretty(initialValuesTemplate(response.schema, resetValues ? null : loadedValues)),
          )
        notify.current?.(response.schema)
      })
      .catch((error) => {
        if (request === revision.current) {
          setError(message(error))
          setStatus('tg_editor_draft_needs_attention')
        }
      })
      .finally(() => {
        if (request === revision.current) setPending(false)
      })
  }

  function perform(drag: EditorDrag, target: DropLocation) {
    if (!catalog || pending) return
    try {
      const next = arrange(document, drag, target, catalog)
      if (next.schema !== document) apply(next.schema, next.selection)
    } catch (error) {
      setError(message(error))
    }
  }

  function add(type: string) {
    const parent = selected && (isGroup(selected) || isRepeater(selected)) ? selection : []
    const component = componentAt(document, parent)
    perform(
      { kind: 'palette', type },
      {
        parent,
        index: component ? childrenOf(component).length : document.form.length,
      },
    )
  }

  function startDrag(event: DragEvent<HTMLElement>, payload: EditorDrag) {
    if (pending) {
      event.preventDefault()
      return
    }
    event.stopPropagation()
    event.dataTransfer.setData(EDITOR_DRAG_MIME, JSON.stringify({ editorId, payload }))
    event.dataTransfer.setData(
      'text/plain',
      payload.kind === 'palette' ? payload.type : (componentAt(document, payload.path)?.key ?? ''),
    )
    event.dataTransfer.effectAllowed = payload.kind === 'palette' ? 'copy' : 'move'
    setDrag(payload)
  }

  function drop(event: DragEvent<HTMLElement>, target: DropLocation) {
    setDrag(null)
    try {
      const transfer = JSON.parse(event.dataTransfer.getData(EDITOR_DRAG_MIME)) as {
        editorId: string
        payload: EditorDrag
      }
      if (transfer.editorId === editorId && drag) perform(drag, target)
    } catch {
      /* External drops are not editor commands. */
    }
  }

  const dragHandlers = { onDragStart: startDrag, onDragEnd: () => setDrag(null) }
  const palette = catalog
    ? [
        {
          label: 'tg_editor_text_inputs',
          fields: catalog.fields.filter((field) => field.valueType === 'string'),
        },
        {
          label: 'tg_editor_numbers_choices',
          fields: catalog.fields.filter(
            (field) => field.valueType === 'number' || field.valueType === 'boolean',
          ),
        },
        {
          label: 'tg_editor_other_fields',
          fields: catalog.fields.filter(
            (field) => !['string', 'number', 'boolean'].includes(field.valueType),
          ),
        },
        {
          label: 'tg_editor_structure',
          fields: [
            {
              type: 'group',
              label: 'tg_editor_group',
              description: 'tg_editor_a_layout_containing_fields_or_sections',
            },
            {
              type: 'repeater',
              label: 'tg_editor_repeater',
              description: 'tg_editor_an_array_of_instances_of_one_template',
            },
          ],
        },
      ].filter((category) => category.fields.length > 0)
    : []

  function undo() {
    const previous = history.at(-1)
    if (!previous) return
    setHistory(history.slice(0, -1))
    setFuture([...future, document])
    apply(previous, [], false)
  }

  function redo() {
    const next = future.at(-1)
    if (!next) return
    setFuture(future.slice(0, -1))
    setHistory([...history, document])
    apply(next, [], false)
  }

  function download() {
    const url = URL.createObjectURL(new Blob([pretty(document)], { type: 'application/json' }))
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = 'tungsten-sprout.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(pretty(document))
      setStatus('tg_editor_schema_copied')
    } catch {
      setError('tg_editor_copy_is_unavailable_here_use_download_json_or_select_the_json_text')
    }
  }

  function openSettings(path: ComponentPath) {
    setSelection(path)
    setSettingsOpen(true)
  }

  const target =
    selected && (isGroup(selected) || isRepeater(selected)) ? selected.key : 'tg_editor_form_root'
  return (
    <div
      className="te-root"
      lang={language}
      data-tg-color-scheme={colorScheme}
      data-tg-color-profile={colorProfile}
    >
      <div className="te-toolbar">
        <div className="te-mode-switch" role="tablist" aria-label={t('tg_editor_editor_mode')}>
          {(['editor', 'preview', 'json'] as const).map((tab, index, tabs) => (
            <button
              type="button"
              role="tab"
              key={tab}
              id={`${editorId}-view-${tab}`}
              aria-selected={mode === tab}
              aria-controls={`${editorId}-view-panel-${tab}`}
              tabIndex={mode === tab ? 0 : -1}
              onClick={() => setMode(tab)}
              onKeyDown={(event) => {
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : -1
                if (next >= 0) {
                  event.preventDefault()
                  setMode(tabs[next])
                  window.document.getElementById(`${editorId}-view-${tabs[next]}`)?.focus()
                }
              }}
            >
              <TungstenLang>{`tg_editor_view_${tab}`}</TungstenLang>
            </button>
          ))}
        </div>
        <span className={`te-status ${error ? 'te-status-error' : ''}`} role="status">
          <TungstenLang>{status}</TungstenLang>
        </span>
        <div className="te-tools">
          <button
            type="button"
            onClick={undo}
            disabled={!history.length || pending}
            aria-label={t('tg_editor_undo_schema_change')}
          >
            ↶
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!future.length || pending}
            aria-label={t('tg_editor_redo_schema_change')}
          >
            ↷
          </button>
          <button type="button" onClick={copy}>
            <TungstenLang>tg_editor_copy_json</TungstenLang>
          </button>
          <button type="button" onClick={download}>
            <TungstenLang>tg_editor_download</TungstenLang>
          </button>
        </div>
      </div>
      {error && !settingsOpen ? (
        <div className="te-error" role="alert">
          <strong>
            <TungstenLang>tg_editor_check_your_draft</TungstenLang>
          </strong>
          <p>
            <TungstenLang>{error}</TungstenLang>
          </p>
          {preview ? (
            <p>
              <TungstenLang>tg_editor_the_preview_shows_the_last_accepted_schema</TungstenLang>
            </p>
          ) : null}
        </div>
      ) : null}
      <div className={`te-workspace te-workspace--${mode}`}>
        <div
          className="te-authoring-view"
          id={`${editorId}-view-panel-editor`}
          role="tabpanel"
          aria-labelledby={`${editorId}-view-editor`}
          aria-hidden={mode !== 'editor'}
          inert={mode !== 'editor'}
        >
          <aside className="te-palette" aria-label={t('tg_editor_field_palette_and_outline')}>
            <h2>
              <TungstenLang>tg_editor_components</TungstenLang>
            </h2>
            <p className="te-muted te-add-target">
              <TungstenLang>tg_editor_adding_to</TungstenLang>{' '}
              <strong>
                <TungstenLang>{target}</TungstenLang>
              </strong>
            </p>
            {!catalog ? (
              <p role="status">
                <TungstenLang>tg_editor_loading_available_fields</TungstenLang>
              </p>
            ) : (
              <div className="te-palette-categories">
                {palette.map((category) => (
                  <section
                    key={category.label}
                    aria-label={t(category.label)}
                    className="te-palette-category"
                  >
                    <h3>
                      <TungstenLang>{category.label}</TungstenLang>
                    </h3>
                    <div className="te-palette-buttons">
                      {category.fields.map((field) => (
                        <button
                          type="button"
                          key={field.type}
                          title={t('tg_editor_drag_onto_the_layout_or_click_to_add', {
                            p0: { messageKey: field.description },
                          })}
                          disabled={pending}
                          draggable={!pending}
                          onDragStart={(event) =>
                            startDrag(event, {
                              kind: 'palette',
                              type: field.type,
                            })
                          }
                          onDragEnd={dragHandlers.onDragEnd}
                          onClick={() => add(field.type)}
                        >
                          <span aria-hidden="true">⠿</span>
                          <TungstenLang>{field.label}</TungstenLang>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
            <div className="te-outline-heading">
              <h3>
                <TungstenLang>tg_editor_form_outline</TungstenLang>
              </h3>
              <button
                type="button"
                onClick={() => setSelection([])}
                aria-pressed={!selection.length}
              >
                <TungstenLang>tg_editor_root</TungstenLang>
              </button>
            </div>
            <Outline
              components={document.form}
              selection={selection}
              pending={pending}
              onSelect={openSettings}
              {...dragHandlers}
            />
            {!document.form.length ? (
              <p className="te-empty">
                <TungstenLang>
                  tg_editor_a_little_room_to_grow_add_your_first_field_above
                </TungstenLang>
              </p>
            ) : null}
          </aside>
          <section className="te-inspector">
            <EditorCanvas
              schema={document}
              selection={selection}
              drag={drag}
              pending={pending}
              onSelect={openSettings}
              onDrop={drop}
              onMove={(path, target) =>
                perform(
                  {
                    kind: 'component',
                    path,
                  },
                  target,
                )
              }
              {...dragHandlers}
            />
          </section>
        </div>
        <section
          className="te-json-view te-inspector"
          id={`${editorId}-view-panel-json`}
          role="tabpanel"
          aria-labelledby={`${editorId}-view-json`}
          aria-hidden={mode !== 'json'}
          inert={mode !== 'json'}
        >
          <h2>
            <TungstenLang>tg_editor_json_editor</TungstenLang>
          </h2>
          <p className="te-muted">
            <TungstenLang>
              tg_editor_import_or_edit_a_sprout_schema_invalid_drafts_stay_editable
            </TungstenLang>
          </p>
          <JSONInput
            inputId={`${editorId}-schema-json`}
            label="tg_editor_schema_json"
            value={json}
            onChange={(value) => {
              setJSON(value)
              setJSONDirty(true)
            }}
          />
          <button
            className="te-primary"
            type="button"
            disabled={pending || !catalog || !jsonDirty}
            onClick={() => {
              try {
                apply(parseSchema(json, catalog!.maxDepth), [])
              } catch (error) {
                setError(message(error))
              }
            }}
          >
            <TungstenLang>tg_editor_apply_json</TungstenLang>
          </button>
        </section>
        <section
          className="te-preview"
          id={`${editorId}-view-panel-preview`}
          role="tabpanel"
          aria-labelledby={`${editorId}-view-preview`}
          aria-hidden={mode !== 'preview'}
          inert={mode !== 'preview'}
        >
          <div className="te-preview-heading">
            <div>
              <h2>
                <TungstenLang>tg_editor_live_preview</TungstenLang>
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setPreviewRevision((r) => r + 1)
                setSubmitted(null)
              }}
              disabled={!preview}
            >
              <TungstenLang>tg_editor_reset</TungstenLang>
            </button>
          </div>
          <div className="te-preview-split">
            <div
              className="te-preview-input"
              role="region"
              aria-label={t('tg_editor_live_preview')}
            >
              <div className="te-preview-form">
                {preview ? (
                  <Tungsten
                    key={previewRevision}
                    schema={preview}
                    initialValues={loadedValues}
                    design={design}
                    config={config}
                    dataSources={dataSources}
                    onStateChange={setSnapshot}
                    onSubmit={setSubmitted}
                  />
                ) : (
                  <p className="te-empty">
                    <TungstenLang>tg_editor_a_valid_schema_will_appear_here</TungstenLang>
                  </p>
                )}
              </div>
              {submitted ? (
                <details className="te-details" open>
                  <summary>
                    <TungstenLang>tg_editor_submitted_values</TungstenLang>
                  </summary>
                  <pre>{pretty(submitted)}</pre>
                </details>
              ) : null}
              <details className="te-details">
                <summary>
                  <TungstenLang>tg_editor_load_initial_values</TungstenLang>
                </summary>
                <p>
                  <TungstenLang>
                    tg_editor_the_keys_are_filled_from_your_schema_empty_collections_include_one_sample_item_to_show
                  </TungstenLang>
                </p>
                <JSONInput
                  inputId={`${editorId}-initial-values`}
                  label="tg_editor_initial_values_json"
                  value={valueJSON}
                  onChange={(value) => {
                    valueJSONDirty.current = true
                    setValueJSON(value)
                  }}
                />
                <button
                  type="button"
                  disabled={pending || !preview}
                  onClick={() => {
                    try {
                      const values = JSON.parse(valueJSON) as TungstenValues | null
                      if (values !== null && (typeof values !== 'object' || Array.isArray(values)))
                        throw new Error(
                          JSON.stringify({
                            messageKey: 'tg_editor_initial_values_must_be_an_object_or_null',
                            params: {},
                          }),
                        )
                      setPending(true)
                      const request = ++revision.current
                      void client
                        .current!.load(preview!, values)
                        .then(() => {
                          if (request === revision.current) {
                            setLoadedValues(values)
                            setPreviewRevision((r) => r + 1)
                            setError(null)
                            setStatus('tg_editor_values_loaded')
                            valueJSONDirty.current = false
                            setValueJSON(pretty(initialValuesTemplate(preview!, values)))
                          }
                        })
                        .catch((error) => {
                          if (request === revision.current) setError(message(error))
                        })
                        .finally(() => {
                          if (request === revision.current) setPending(false)
                        })
                    } catch (error) {
                      setError(message(error))
                    }
                  }}
                >
                  <TungstenLang>tg_editor_load_values</TungstenLang>
                </button>
                <button
                  type="button"
                  disabled={!preview || pending}
                  onClick={() => {
                    try {
                      const values = JSON.parse(valueJSON) as TungstenValues | null
                      if (values !== null && (typeof values !== 'object' || Array.isArray(values)))
                        throw new Error(
                          JSON.stringify({
                            messageKey: 'tg_editor_initial_values_must_be_an_object_or_null',
                            params: {},
                          }),
                        )
                      setValueJSON(pretty(initialValuesTemplate(preview!, values)))
                    } catch (error) {
                      setError(message(error))
                    }
                  }}
                >
                  <TungstenLang>tg_editor_fill_keys_from_schema</TungstenLang>
                </button>
              </details>
            </div>
            <div className="te-preview-data">
              <div
                className="te-preview-tabs"
                role="tablist"
                aria-label={t('tg_editor_preview_panels')}
              >
                {['state', 'values'].map((tab) => (
                  <button
                    type="button"
                    key={tab}
                    id={`${editorId}-tab-${tab}`}
                    role="tab"
                    aria-selected={previewTab === tab}
                    aria-controls={`${editorId}-panel-${tab}`}
                    tabIndex={previewTab === tab ? 0 : -1}
                    onKeyDown={(event) => {
                      const tabs = ['state', 'values']
                      const index = tabs.indexOf(tab)
                      const next =
                        event.key === 'ArrowRight'
                          ? (index + 1) % 2
                          : event.key === 'ArrowLeft'
                            ? (index + 1) % 2
                            : event.key === 'Home'
                              ? 0
                              : event.key === 'End'
                                ? 1
                                : -1
                      if (next >= 0) {
                        event.preventDefault()
                        setPreviewTab(tabs[next])
                        window.document.getElementById(`${editorId}-tab-${tabs[next]}`)?.focus()
                      }
                    }}
                    onClick={() => setPreviewTab(tab)}
                  >
                    <TungstenLang>{`tg_editor_tab_${tab}`}</TungstenLang>
                  </button>
                ))}
              </div>
              <div
                id={`${editorId}-panel-values`}
                role="tabpanel"
                aria-labelledby={`${editorId}-tab-values`}
                hidden={previewTab !== 'values'}
              >
                <p className="te-muted">
                  <TungstenLang>
                    tg_editor_current_evaluated_values_updated_as_you_type
                  </TungstenLang>
                </p>
                <pre className="te-json-output">
                  {snapshot ? (
                    pretty(snapshot.values)
                  ) : (
                    <TungstenLang>tg_editor_waiting_for_the_preview</TungstenLang>
                  )}
                </pre>
              </div>
              <div
                id={`${editorId}-panel-state`}
                role="tabpanel"
                aria-labelledby={`${editorId}-tab-state`}
                hidden={previewTab !== 'state'}
              >
                <p className="te-muted">
                  <TungstenLang>tg_editor_visibility_errors_and_collection_metadata</TungstenLang>{' '}
                  <TungstenLang>
                    {snapshot
                      ? snapshot.valid
                        ? 'tg_editor_the_form_is_valid'
                        : 'tg_editor_the_form_has_validation_errors'
                      : ''}
                  </TungstenLang>
                </p>
                <pre className="te-json-output">
                  {snapshot ? (
                    pretty(snapshot.state)
                  ) : (
                    <TungstenLang>tg_editor_waiting_for_the_preview</TungstenLang>
                  )}
                </pre>
              </div>
            </div>
          </div>
        </section>
      </div>
      <dialog
        ref={settingsDialog}
        className="te-settings-dialog"
        aria-labelledby={`${editorId}-settings-title`}
        onCancel={() => setSettingsOpen(false)}
        onClose={() => setSettingsOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const box = event.currentTarget.getBoundingClientRect()
            if (
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom
            )
              setSettingsOpen(false)
          }
        }}
      >
        {settingsOpen ? (
          <>
            <div className="te-dialog-actions">
              {selected ? (
                <button
                  type="button"
                  className="te-dialog-icon te-dialog-delete"
                  aria-label={t('tg_editor_delete', { p0: selected.key })}
                  disabled={pending}
                  onClick={() => {
                    apply(replaceAt(document, selection, null), [])
                    setSettingsOpen(false)
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                className="te-dialog-icon"
                aria-label={t('tg_editor_close_settings')}
                onClick={() => setSettingsOpen(false)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="m6 6 12 12M6 18 18 6" />
                </svg>
              </button>
            </div>
            <div className="te-inspector-heading">
              <div>
                <h2 id={`${editorId}-settings-title`}>
                  <TungstenLang>
                    {selected?.view?.label || (selected ? selected.key : 'tg_editor_your_form')}
                  </TungstenLang>
                </h2>
              </div>
            </div>
            <p className="te-muted">
              <TungstenLang>
                {selected
                  ? 'tg_editor_settings_use_the_same_engine_as_your_form'
                  : 'tg_editor_use_the_component_list_to_arrange_your_form_select_a_field_in_the_outline_to_edit_it'}
              </TungstenLang>
            </p>
            {settings.error ? (
              <div className="te-error" role="alert">
                <p>
                  <TungstenLang>tg_editor_use_json_mode_to_repair_this_draft</TungstenLang>
                </p>
                <p>
                  <TungstenLang>{settings.error}</TungstenLang>
                </p>
              </div>
            ) : null}
            {settings.form ? (
              <Tungsten
                key={selection.join('.')}
                config={inspectorConfig}
                schema={settings.form.schema}
                initialValues={settings.form.values}
                design={editorDesign}
                onSubmit={(values) => {
                  return apply(
                    applyInspector(document, selection, values, catalog!),
                    selection,
                    true,
                    {
                      closeSettings: true,
                    },
                  )
                }}
              />
            ) : null}
          </>
        ) : null}
      </dialog>
    </div>
  )
}
