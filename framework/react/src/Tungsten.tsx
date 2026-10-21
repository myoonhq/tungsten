import { TungstenLanguageProvider, useTungstenLang } from './i18n.js'
import { TungstenThemeProvider } from './theme.js'
import { messageOf, type TungstenText } from '../../../api/src/i18n.js'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useInsertionEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { FormOperations, type OperationStatus } from '../../../api/src/operations.js'
import { inputIds } from './input-ids.js'
import { FormView } from './FormView.js'
import { fieldOf, fieldKeys } from '../../../api/src/engine/snapshots.js'
import { FormViewStore } from './view-store.js'
import { EngineClient } from '../../../api/src/engine/client.js'
import { fieldTypeOf, fieldsOf, isGroup, isRepeater } from '../../../api/src/types.js'
import tungsten from '../../../design/tungsten/src/index.js'
import type { RepeaterOperation } from '../../../api/src/engine/protocol.js'
import type {
  FormState,
  RepeaterItem,
  GroupRevealRequest,
  ScalarValue,
  TungstenComponent,
  TungstenDesign,
  TungstenField,
  TungstenProps,
  TungstenSchema,
  TungstenValues,
} from './types.js'

const emptyConfig: import('../../../api/src/http.js').TungstenConfig = {}
const emptySources = {}

export function Tungsten(props: TungstenProps) {
  const inherited = useTungstenLang()
  const config = props.config ?? emptyConfig
  // Translation changes must never reload or reevaluate the engine.
  const transport = useMemo(
    () => ({
      apis: config.apis,
      request: config.request,
      maxProcessingSteps: config.maxProcessingSteps,
      warnings: config.warnings,
    }),
    [config.apis, config.request, config.maxProcessingSteps, config.warnings],
  )
  const operationTransport = useMemo(
    () => ({
      apis: config.apis,
      request: config.request,
      autosave: config.autosave,
      submission: config.submission,
    }),
    [config.apis, config.request, config.autosave, config.submission],
  )
  const engine = (
    <TungstenEngine {...props} config={transport} operationConfig={operationTransport} />
  )
  return (
    <TungstenLanguageProvider
      inherit={props.language === undefined && !config.i18n}
      language={props.language ?? inherited.language}
      config={config.i18n}
      transport={transport}
    >
      <TungstenThemeProvider colorScheme={props.colorScheme} colorProfile={props.colorProfile}>
        {engine}
      </TungstenThemeProvider>
    </TungstenLanguageProvider>
  )
}

function TungstenEngine({
  schema,
  initialValues = null,
  design = tungsten,
  config = emptyConfig,
  dataSources = emptySources,
  onReady,
  onSubmit,
  onStateChange,
  onDiagnostic,
  onSave,
  operationConfig,
}: TungstenProps & { operationConfig: import('../../../api/src/http.js').TungstenConfig }) {
  const [viewStore] = useState(() => new FormViewStore())
  const operations = useRef<FormOperations | null>(null)
  const initialSourceFields = useRef(new Set<string>())
  const operationHandlers = useRef({ onSave, onSubmit })
  useEffect(() => {
    operationHandlers.current = { onSave, onSubmit }
  }, [onSave, onSubmit])
  const hasSaveHandler = !!onSave
  const [saveStatus, setSaveStatus] = useState<OperationStatus>('idle')
  const [submitStatus, setSubmitStatus] = useState<OperationStatus>('idle')
  const { t } = useTungstenLang()
  const diagnosticObserver = useRef({ onDiagnostic, t })
  useEffect(() => {
    diagnosticObserver.current = { onDiagnostic, t }
  }, [onDiagnostic, t])
  const [snapshot, setSnapshot] = useState<{
    source: TungstenSchema
    valuesSource: TungstenValues | null
    schema: TungstenSchema
    state: FormState
  } | null>(null)
  const [loadFailure, setLoadFailure] = useState<{
    schema: TungstenSchema
    initialValues: TungstenValues | null
    message: TungstenText
  } | null>(null)
  const [runtimeError, setRuntimeError] = useState<TungstenText | null>(null)
  const [operationError, setOperationError] = useState<TungstenText | null>(null)
  const [changingStructure, setChangingStructure] = useState(false)
  const structureRef = useRef(false)
  const structureFocus = useRef<{ element: HTMLElement | null; fieldKey?: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reveal, setReveal] = useState<GroupRevealRequest | null>(null)
  const revealCounter = useRef(0)
  const focusedReveal = useRef(0)
  const submittingRef = useRef(false)
  const clientRef = useRef<EngineClient | null>(null)
  const activeSchemaRef = useRef(schema)
  const activeValuesRef = useRef(initialValues)
  const loadRevision = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const instanceId = useId().replaceAll(':', '')
  const current =
    snapshot?.source === schema && snapshot.valuesSource === initialValues ? snapshot : null
  const loadError =
    loadFailure?.schema === schema && loadFailure.initialValues === initialValues
      ? loadFailure.message
      : null

  const compiled = current?.schema
  const collections = current?.state.repeaters
  const leaves = useMemo(
    () => (compiled ? fieldsOf(compiled.form, { fields: {}, repeaters: collections }) : []),
    [compiled, collections],
  )
  const failure = useMemo(
    () => (compiled ? rendererFailure(compiled.form, design) : null),
    [compiled, design],
  )

  const shape = current ? fieldKeys(current.state) : undefined
  const keys = useMemo(() => new Set(shape), [shape])
  const missingState = useMemo(() => leaves.find((field) => !keys.has(field.key)), [leaves, keys])

  const readyObserver = useRef(onReady)
  useEffect(() => {
    readyObserver.current = onReady
  }, [onReady])
  const observer = useRef(onStateChange)
  useEffect(() => {
    observer.current = onStateChange
  }, [onStateChange])
  useEffect(() => {
    if (!current || current.state !== viewStore.state) return
    const state = current.state
    if (failure) return
    let initialSourceCompletion = false
    for (const key of initialSourceFields.current) {
      const field = fieldOf(state, key)
      if (
        field &&
        !field.unresolved &&
        !field.loadingSources?.length &&
        !Object.keys(field.sourceErrors ?? {}).length
      ) {
        initialSourceFields.current.delete(key)
        initialSourceCompletion = true
      }
    }
    operations.current?.observeSnapshot(
      () => valuesFrom(leaves, state),
      viewStore.contentRevision,
      initialSourceCompletion,
    )
    if (!observer.current) return
    observer.current({
      schema: current.schema,
      state,
      values: valuesFrom(leaves, state),
      valid: viewStore.valid,
    })
  }, [current, design, failure, leaves, viewStore])

  useInsertionEffect(() => {
    design.install?.()
  }, [design])

  useEffect(() => {
    const client = new EngineClient()
    clientRef.current = client
    const unsubscribeDiagnostics = client.subscribeDiagnostic?.((severity, text) => {
      if (severity === 'error') setRuntimeError(text)
      const message = messageOf(text)
      const structured = typeof message === 'string' ? { messageKey: message, params: {} } : message
      diagnosticObserver.current.onDiagnostic?.({
        severity,
        messageKey: structured.messageKey,
        params: structured.params ?? {},
        message: diagnosticObserver.current.t(message),
      })
    })
    const subscribe = client.subscribeChanges?.bind(client) ?? client.subscribe?.bind(client)
    const unsubscribe = subscribe?.((state, changed?: readonly string[]) => {
      viewStore.update(state, changed)
      setSnapshot((previous) =>
        previous?.source === activeSchemaRef.current &&
        previous.valuesSource === activeValuesRef.current
          ? previous.state === state
            ? previous
            : { ...previous, state }
          : previous,
      )
    })
    return () => {
      unsubscribe?.()
      unsubscribeDiagnostics?.()
      if (clientRef.current === client) clientRef.current = null
      client.destroy()
    }
  }, [viewStore])

  useEffect(() => {
    let active = true
    let coordinator: FormOperations
    try {
      coordinator = new FormOperations(
        operationConfig,
        {
          save: hasSaveHandler
            ? (values, outcome) => operationHandlers.current.onSave?.(values, outcome)
            : undefined,
          submit: (values, outcome) =>
            outcome === undefined
              ? operationHandlers.current.onSubmit?.(values)
              : operationHandlers.current.onSubmit?.(values, outcome),
        },
        (operation, status) => {
          if (!active) return
          if (operation === 'save') setSaveStatus(status)
          else setSubmitStatus(status)
        },
        async (values) => {
          const containsPendingFiles = (value: unknown): boolean => {
            if (!value || typeof value !== 'object') return false
            if (Array.isArray(value)) return value.some(containsPendingFiles)
            const object = value as Record<string, unknown>
            if (
              Array.isArray(object.files) &&
              object.files.some((file) => file && typeof file === 'object' && !file.uploaded)
            )
              return true
            return Object.values(object).some(containsPendingFiles)
          }
          const pendingFiles = containsPendingFiles(values)
          if (!pendingFiles) return values
          const response = await clientRef.current!.prepareFiles({ allowInvalid: true })
          return (
            response.values ?? valuesFrom(fieldsOf(schema.form, response.state), response.state)
          )
        },
      )
      operations.current = coordinator
      queueMicrotask(() => {
        if (active) setOperationError(null)
      })
    } catch (error) {
      queueMicrotask(() => {
        if (active) setOperationError(errorMessage(error))
      })
      return
    }
    return () => {
      active = false
      coordinator.close()
      if (operations.current === coordinator) operations.current = null
    }
  }, [operationConfig, schema, initialValues, hasSaveHandler])

  useEffect(() => {
    const client = clientRef.current!
    let active = true
    activeSchemaRef.current = schema
    activeValuesRef.current = initialValues
    loadRevision.current += 1
    submittingRef.current = false
    structureRef.current = false
    structureFocus.current = null
    void Promise.resolve()
      .then(() => {
        client.configure?.(config, dataSources)
        return client.load(schema, initialValues, { preserveState: true })
      })
      .then((response) => {
        if (active && clientRef.current === client) {
          initialSourceFields.current = new Set(
            Object.entries(response.state.fields)
              .filter(([, field]) => field.unresolved || field.loadingSources?.length)
              .map(([key]) => key),
          )
          viewStore.update(response.state)
          // Establish the baseline before exposing the controller or controls.
          // React may batch the first edit with the initial render's effects.
          operations.current?.observeSnapshot(
            () => valuesFrom(fieldsOf(response.schema.form, response.state), response.state),
            viewStore.contentRevision,
          )
          setSnapshot({
            source: schema,
            valuesSource: initialValues,
            schema: response.schema,
            state: response.state,
          })
          setLoadFailure(null)
          setRuntimeError(null)
          setSubmitting(false)
          setChangingStructure(false)
          setReveal(null)
          readyObserver.current?.(client)
        }
      })
      .catch((error: unknown) => {
        if (active && clientRef.current === client) {
          setLoadFailure({ schema, initialValues, message: errorMessage(error) })
          setSubmitting(false)
        }
      })
    return () => {
      active = false
    }
  }, [schema, initialValues, config, dataSources, viewStore])

  useEffect(() => {
    if (
      !current ||
      !reveal ||
      submitting ||
      changingStructure ||
      focusedReveal.current === reveal.requestId
    )
      return
    const id = inputIds(current.schema, current.state, instanceId).get(reveal.fieldKey)
    if (!id) return
    // Child effects open native dialogs before the host focuses the revealed field.
    const input = document.getElementById(id)
    if (input && rootRef.current?.contains(input) && !input.matches(':disabled')) {
      input.focus()
      if (document.activeElement === input || input.contains(document.activeElement))
        focusedReveal.current = reveal.requestId
    }
  }, [current, instanceId, reveal, submitting, changingStructure])

  useEffect(() => {
    if (changingStructure || !current || !structureFocus.current) return
    const focus = structureFocus.current
    structureFocus.current = null
    if (focus.element?.isConnected && !focus.element.matches(':disabled')) {
      focus.element.focus()
    } else if (focus.fieldKey) {
      revealCounter.current += 1
      setReveal({ fieldKey: focus.fieldKey, requestId: revealCounter.current })
    }
  }, [changingStructure, current])

  const changeValue = useCallback(
    (field: TungstenField, value: ScalarValue) => {
      const client = clientRef.current
      if (!client || submittingRef.current || structureRef.current) return
      const revision = loadRevision.current
      setRuntimeError(null)
      return client
        .patch({ kind: 'set_value', key: field.key, value })
        .then((response) => {
          if (
            clientRef.current === client &&
            activeSchemaRef.current === schema &&
            activeValuesRef.current === initialValues &&
            loadRevision.current === revision
          ) {
            if (
              response.patches.some(
                (patch) => patch.kind === 'set_value' || patch.kind === 'clear_value',
              )
            )
              operations.current?.markEdited()
            viewStore.update(response.state)
            setSnapshot((previous) =>
              previous?.source === schema && previous.valuesSource === initialValues
                ? previous.state === response.state
                  ? previous
                  : { ...previous, state: response.state }
                : previous,
            )
          }
        })
        .catch((error: unknown) => {
          if (
            clientRef.current === client &&
            activeSchemaRef.current === schema &&
            activeValuesRef.current === initialValues &&
            loadRevision.current === revision
          )
            setRuntimeError(errorMessage(error))
        })
    },
    [schema, initialValues, viewStore],
  )

  const changeStructure = useCallback(
    (operation: RepeaterOperation) => {
      const client = clientRef.current
      if (!client || submittingRef.current || structureRef.current) return
      const revision = loadRevision.current
      structureRef.current = true
      structureFocus.current = {
        element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      }
      setChangingStructure(true)
      setRuntimeError(null)
      void client
        .structure(operation)
        .then((response) => {
          if (
            clientRef.current === client &&
            activeSchemaRef.current === schema &&
            activeValuesRef.current === initialValues &&
            loadRevision.current === revision
          ) {
            operations.current?.markEdited()
            const collection = response.state.repeaters?.[operation.key]
            const index =
              operation.kind === 'add'
                ? (collection?.length ?? 0) - 1
                : operation.kind === 'remove'
                  ? Math.min(operation.index, (collection?.length ?? 0) - 1)
                  : operation.to
            const instance = collection?.instances[index]
            const field =
              instance &&
              fieldsOf(instance.form, response.state).find(
                (field) => !response.state.fields[field.key].hidden,
              )
            if (structureFocus.current) {
              if (operation.kind === 'add') structureFocus.current.element = null
              structureFocus.current.fieldKey = field?.key
            }
            viewStore.update(response.state)
            setSnapshot((previous) =>
              previous?.source === schema && previous.valuesSource === initialValues
                ? previous.state === response.state
                  ? previous
                  : { ...previous, state: response.state }
                : previous,
            )
            setReveal(null)
          }
        })
        .catch((error: unknown) => {
          if (clientRef.current === client && loadRevision.current === revision)
            setRuntimeError(errorMessage(error))
        })
        .finally(() => {
          if (clientRef.current === client && loadRevision.current === revision) {
            structureRef.current = false
            setChangingStructure(false)
          }
        })
    },
    [schema, initialValues, viewStore],
  )

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const client = clientRef.current
      if (!client || !current || submittingRef.current || structureRef.current) return
      const revision = loadRevision.current
      submittingRef.current = true
      setSubmitting(true)
      setRuntimeError(null)
      try {
        const response = client.prepareFiles ? await client.prepareFiles() : await client.validate()
        if (
          clientRef.current !== client ||
          activeSchemaRef.current !== schema ||
          activeValuesRef.current !== initialValues ||
          loadRevision.current !== revision
        )
          return
        viewStore.update(response.state)
        setSnapshot((previous) =>
          previous?.state === response.state ? previous : { ...current, state: response.state },
        )
        const leaves = fieldsOf(current.schema.form, response.state)
        if (!response.valid) {
          const invalid = leaves.find((field) => {
            const state = response.state.fields[field.key]
            return (
              state &&
              !state.hidden &&
              !state.disabled &&
              (state.errors.length > 0 ||
                state.loadingSources?.length ||
                Object.keys(state.sourceErrors ?? {}).length ||
                state.unresolved ||
                state.uploadError)
            )
          })
          if (invalid) {
            revealCounter.current += 1
            setReveal({ fieldKey: invalid.key, requestId: revealCounter.current })
          } else {
            setRuntimeError(
              Object.values(response.state.repeaters ?? {}).flatMap(
                (collection) => collection.errors,
              )[0] ?? 'tg_ui_hidden_errors',
            )
          }
          return
        }
        const coordinator = operations.current
        if (!coordinator) throw new Error('tg_api_operations_unavailable')
        await coordinator.submit(response.values ?? valuesFrom(leaves, response.state))
      } catch (error: unknown) {
        if (
          clientRef.current === client &&
          activeSchemaRef.current === schema &&
          activeValuesRef.current === initialValues &&
          loadRevision.current === revision
        )
          setRuntimeError(errorMessage(error))
      } finally {
        if (
          clientRef.current === client &&
          activeSchemaRef.current === schema &&
          activeValuesRef.current === initialValues &&
          loadRevision.current === revision
        ) {
          submittingRef.current = false
          setSubmitting(false)
        }
      }
    },
    [current, schema, initialValues, viewStore],
  )

  const onFiles = useCallback((field: TungstenField, files: readonly File[]) => {
    if (submittingRef.current || structureRef.current) return
    const client = clientRef.current!,
      revision = loadRevision.current
    void client.selectFiles(field, files).catch((error: unknown) => {
      if (clientRef.current === client && revision === loadRevision.current)
        setRuntimeError(errorMessage(error))
    })
  }, [])
  const onRetry = useCallback(
    (field: TungstenField, upload = true) => {
      const client = clientRef.current!,
        revision = loadRevision.current
      const state = viewStore.field(field.key)
      const requests: Promise<unknown>[] = Object.keys(state?.sourceErrors ?? {}).map((id) =>
        client.retrySource(id),
      )
      if (upload && state?.uploadError) requests.push(client.prepareFiles())
      void Promise.all(requests).catch((error: unknown) => {
        if (clientRef.current === client && revision === loadRevision.current)
          setRuntimeError(errorMessage(error))
      })
    },
    [viewStore],
  )

  if (loadError) return <design.Failure message={loadError} />
  if (operationError) return <design.Failure message={operationError} />
  if (!current) return <design.Loading />

  const { state } = current
  if (failure) return <design.Failure message={failure} />
  if (missingState)
    return (
      <design.Failure
        message={{ messageKey: 'tg_ui_missing_field_state', params: { key: missingState.key } }}
      />
    )

  const DesignForm = design.Form
  return (
    <div ref={rootRef}>
      <DesignForm
        onSubmit={submit}
        submitting={submitting}
        busy={changingStructure}
        error={runtimeError}
        saveStatus={saveStatus}
        submitStatus={submitStatus}
      >
        <FormView
          schema={current.schema}
          repeaters={state.repeaters}
          store={viewStore}
          design={design}
          instanceId={instanceId}
          busy={submitting || changingStructure}
          reveal={reveal}
          onChange={changeValue}
          onStructure={changeStructure}
          onFiles={onFiles}
          onRetry={onRetry}
        />
      </DesignForm>
    </div>
  )
}

function rendererFailure(
  components: readonly TungstenComponent[],
  design: TungstenDesign,
): TungstenText | null {
  const stack = [...components].reverse()
  while (stack.length) {
    const component = stack.pop()!
    if (isRepeater(component)) {
      if (!Object.hasOwn(design.repeaters ?? {}, component.render.type))
        return {
          messageKey: 'tg_ui_design_has_no_renderer_for_repeater_render_type',
          params: { p0: design.name, p1: component.render.type },
        }
      for (let index = component.template.length - 1; index >= 0; index -= 1)
        stack.push(component.template[index])
    } else if (isGroup(component)) {
      const definition = Object.hasOwn(design.groups ?? {}, component.render.type)
        ? design.groups?.[component.render.type]
        : undefined
      if (!definition)
        return {
          messageKey: 'tg_ui_design_has_no_renderer_for_group_render_type',
          params: { p0: design.name, p1: component.render.type },
        }
      if (definition.variant !== component.variant) {
        return {
          messageKey: 'tg_ui_design_group_renderer_does_not_support_variant',
          params: { p0: design.name, p1: component.render.type, p2: component.variant },
        }
      }
      for (let index = component.subform.length - 1; index >= 0; index -= 1)
        stack.push(component.subform[index])
    } else if (!Object.hasOwn(design.fields, fieldTypeOf(component))) {
      return {
        messageKey: 'tg_ui_design_has_no_renderer_for_field_type',
        params: { p0: design.name, p1: fieldTypeOf(component) },
      }
    }
  }
  return null
}

function valuesFrom(fields: readonly TungstenField[], state: FormState): TungstenValues {
  const values: TungstenValues = Object.fromEntries(
    fields
      .filter((field) => !field.key.includes('['))
      .map((field) => [field.key, fieldOf(state, field.key)!.value]),
  )
  function collectionValues(key: string): RepeaterItem[] {
    return state.repeaters![key].instances.map((instance, index) => {
      const item = Object.create(null) as RepeaterItem
      const prefix = `${key}[${index}].`
      function walk(components: readonly TungstenComponent[]) {
        for (const component of components) {
          if (isGroup(component)) {
            walk(component.subform)
            continue
          }
          const parts = component.key.slice(prefix.length).split('.')
          let object = item
          for (const part of parts.slice(0, -1)) {
            object[part] ??= Object.create(null) as RepeaterItem
            object = object[part] as RepeaterItem
          }
          object[parts[parts.length - 1]] = isRepeater(component)
            ? collectionValues(component.key)
            : fieldOf(state, component.key)!.value
        }
      }
      walk(instance.form)
      return item
    })
  }
  for (const key of Object.keys(state.repeaters ?? {}).filter((key) => !key.includes('['))) {
    values[key] = collectionValues(key)
  }
  return values
}
function errorMessage(error: unknown): TungstenText {
  return messageOf(error)
}
