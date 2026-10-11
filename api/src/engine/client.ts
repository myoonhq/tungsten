import { messageOf, TungstenMessageError } from '../i18n.js'
import { ApiClient, type TungstenConfig } from '../http.js'
import { fetchSource, checkResponseSchema, type DataSources } from '../data-sources.js'
import { FileRegistry } from '../files.js'
import { checkDateTimeZones } from '../date.js'
import { fieldsOf, fieldTypeOf, type FormState, type TungstenField } from '../types.js'
import type { IntegrationCommand, IntegrationMetadata, SourceEffect } from './protocol.js'
import { applyFields, fieldOf, reconcileState } from './snapshots.js'
import EngineWorker from './engine.worker?worker'
import type {
  CatalogResponse,
  EngineCommandInput,
  EngineResponse,
  EngineSuccessResponse,
  LoadedResponse,
  Patch,
  RepeaterOperation,
  StructureResponse,
  PatchedResponse,
  ValidatedResponse,
  ValuesLoadedResponse,
  SnapshotResponse,
} from './protocol.js'
import type { TungstenSchema, TungstenValues } from '../types.js'

type PendingRequest = {
  resolve: (response: EngineSuccessResponse) => void
  reject: (error: Error) => void
}

export class EngineClient {
  readonly #worker: Worker
  readonly #pending = new Map<number, PendingRequest>()
  #nextRequestId = 1
  #destroyed = false
  #workerFailure: Error | null = null
  #sources: DataSources = {}
  #initialValues: TungstenValues | null = null
  #processingLimit = 100
  #warnings: 'console' | 'silent' = 'console'
  #diagnostics = new Set<
    (severity: 'error' | 'warning', message: import('../i18n.js').TungstenText) => void
  >()
  #fetchSources = true
  #api = new ApiClient()
  #state: FormState | null = null
  #schema: TungstenSchema | null = null
  #fileFields: readonly TungstenField[] = []
  #generation = ''
  #revision = ''
  #handles: Record<string, string> = {}
  #listeners = new Set<(state: FormState) => void>()
  #changeListeners = new Set<(state: FormState, changed?: readonly string[]) => void>()
  #fetches = new Map<string, { revision: string; controller: AbortController }>()
  #recovery: {
    generation: string
    effects: Map<string, SourceEffect>
    snapshot: Promise<SnapshotResponse>
  } | null = null
  #files = new FileRegistry(
    {
      state: () => this.#state,
      generation: () => this.#generation,
      handle: (key) => this.#handles[key],
      fileFields: () => this.#fileFields,
      integrate: (generation, command) => this.integrate(generation, command),
    },
    this.#api,
  )

  configure(
    config: TungstenConfig = {},
    sources: DataSources = {},
    { fetchSources = true }: { fetchSources?: boolean } = {},
  ): void {
    const limit = config.maxProcessingSteps ?? 100
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 0xffffffff) {
      this.#diagnostic('error', 'tg_schema_invalid_processing_limit')
      throw new Error('tg_schema_invalid_processing_limit')
    }
    this.#processingLimit = limit
    this.#warnings = config.warnings ?? 'console'
    this.#fetchSources = fetchSources
    for (const source of Object.values(sources))
      if (source.schema) checkResponseSchema(source.schema)
    this.#sources = sources
    this.#api = new ApiClient(config)
    this.#files.configure(this.#api)
  }
  subscribeDiagnostic(
    listener: (severity: 'error' | 'warning', message: import('../i18n.js').TungstenText) => void,
  ): () => void {
    this.#diagnostics.add(listener)
    return () => {
      this.#diagnostics.delete(listener)
    }
  }
  #diagnostic(severity: 'error' | 'warning', message: import('../i18n.js').TungstenText): void {
    if (severity === 'error' || this.#warnings === 'console')
      console[severity === 'error' ? 'error' : 'warn'](message)
    for (const listener of this.#diagnostics) {
      try {
        listener(severity, message)
      } catch (error) {
        console.error('Tungsten diagnostic observer failed', error)
      }
    }
  }
  subscribe(listener: (state: FormState) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  /** Affected keys are supplied for deltas; full snapshots require a full refresh. */
  subscribeChanges(listener: (state: FormState, changed?: readonly string[]) => void): () => void {
    this.#changeListeners.add(listener)
    return () => {
      this.#changeListeners.delete(listener)
    }
  }
  integrate(generation: string, command: IntegrationCommand): Promise<PatchedResponse> {
    return this.#request<PatchedResponse>({ kind: 'integrate', generation, command })
  }
  retrySource(id: string): Promise<PatchedResponse> {
    return this.integrate(this.#generation, { kind: 'source', command: { kind: 'retry', id } })
  }
  async selectFiles(field: TungstenField, files: readonly File[]): Promise<PatchedResponse> {
    const value = this.#files.select(files)
    let response: PatchedResponse
    try {
      response = await this.patch({ kind: 'set_value', key: field.key, value })
    } catch (error) {
      this.#files.discard(value)
      throw error
    }
    if (
      (field.upload as { timing?: string })?.timing === 'selection' &&
      fieldOf(response.state, field.key)!.errors.length === 0
    )
      await this.#files.prepare(field)
    return { ...response, state: this.#state! }
  }
  /** Also use before saving a draft: pending browser files become durable references. */
  async prepareFiles({
    allowInvalid = false,
  }: { allowInvalid?: boolean } = {}): Promise<ValidatedResponse> {
    const response = await this.validate()
    const ready = Object.values(response.state.fields).every(
      (f) =>
        f.hidden ||
        f.disabled ||
        (!f.errors.length &&
          !f.loadingSources?.length &&
          !Object.keys(f.sourceErrors ?? {}).length &&
          !f.unresolved),
    )
    if (!ready && !allowInvalid) return response
    for (const field of this.#fileFields) {
      const state = fieldOf(this.#state!, field.key)!
      const hasFiles =
        state.value &&
        typeof state.value === 'object' &&
        !Array.isArray(state.value) &&
        state.value.files.length > 0
      if (state.errors.length && (!allowInvalid || hasFiles)) {
        if (allowInvalid)
          throw new Error(
            JSON.stringify({
              messageKey: 'tg_api_cannot_prepare_invalid_attachments_in',
              params: { p0: field.key },
            }),
          )
        return response
      }
      await this.#files.prepare(field)
    }
    return this.#generation === response.generation && this.#revision === response.revision
      ? response
      : this.validate()
  }

  constructor() {
    this.#worker = new EngineWorker()
    this.#worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      this.#receive(event.data)
    }
    this.#worker.onerror = (event: ErrorEvent) => {
      const message = event.message || 'tg_api_worker_failed'
      this.#workerFailure = new Error(message)
      for (const fetch of this.#fetches.values()) fetch.controller.abort()
      this.#fetches.clear()
      this.#diagnostic('error', message)
      this.#rejectAll(new Error(message))
    }
  }

  catalog(): Promise<CatalogResponse> {
    return this.#request<CatalogResponse>({ kind: 'catalog' })
  }

  load(
    schema: TungstenSchema,
    initialValues: TungstenValues | null = null,
    { preserveState = false }: { preserveState?: boolean } = {},
  ): Promise<LoadedResponse> {
    try {
      checkDateTimeZones(schema.form)
    } catch (error) {
      this.#diagnostic('error', messageOf(error))
      return Promise.reject(error)
    }
    return this.#request<LoadedResponse>({
      kind: 'load',
      schema,
      initialValues,
      preserveState,
      sources: Object.keys(this.#sources),
      processingLimit: this.#processingLimit,
    }).then((response) => {
      this.#initialValues = structuredClone(initialValues)
      return response
    })
  }

  /** Replace values on an initialized schema, derive state, and validate all fields. */
  loadValues(initialValues: TungstenValues | null = null): Promise<ValuesLoadedResponse> {
    return this.#request<ValuesLoadedResponse>({ kind: 'load_values', initialValues }).then(
      (response) => {
        this.#initialValues = structuredClone(initialValues)
        return response
      },
    )
  }

  /** Restore the latest explicit initialization baseline, never an autosave acknowledgment. */
  reset(): Promise<ValuesLoadedResponse> {
    return this.#request<ValuesLoadedResponse>({
      kind: 'load_values',
      initialValues: structuredClone(this.#initialValues),
    })
  }

  patch(patch: Patch): Promise<PatchedResponse> {
    return this.#request<PatchedResponse>({ kind: 'patch', patch })
  }

  structure(operation: RepeaterOperation): Promise<StructureResponse> {
    return this.#request<StructureResponse>({ kind: 'structure', operation })
  }

  addInstance(key: string): Promise<StructureResponse> {
    return this.structure({ kind: 'add', key })
  }
  removeInstance(key: string, index: number): Promise<StructureResponse> {
    return this.structure({ kind: 'remove', key, index })
  }
  reorderInstance(key: string, from: number, to: number): Promise<StructureResponse> {
    return this.structure({ kind: 'reorder', key, from, to })
  }

  validate(): Promise<ValidatedResponse> {
    return this.#request<ValidatedResponse>({ kind: 'validate' })
  }

  destroy(): void {
    if (this.#destroyed) {
      return
    }

    this.#destroyed = true
    this.#worker.terminate()
    this.#files.reset()
    for (const request of this.#fetches.values()) request.controller.abort()
    this.#fetches.clear()
    this.#listeners.clear()
    this.#changeListeners.clear()
    this.#diagnostics.clear()
    this.#rejectAll(
      new Error(JSON.stringify({ messageKey: 'tg_api_tungsten_engine_was_disposed', params: {} })),
    )
  }

  #request<Response extends EngineSuccessResponse>(command: EngineCommandInput): Promise<Response> {
    if (this.#destroyed) {
      return Promise.reject(
        new Error(
          JSON.stringify({ messageKey: 'tg_api_tungsten_engine_was_disposed', params: {} }),
        ),
      )
    }

    if (this.#workerFailure) return Promise.reject(this.#workerFailure)

    const requestId = this.#nextRequestId
    this.#nextRequestId += 1

    return new Promise<Response>((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: (response) => resolve(response as Response),
        reject,
      })
      try {
        this.#worker.postMessage({ ...command, requestId })
      } catch (error) {
        this.#pending.delete(requestId)
        this.#diagnostic('error', messageOf(error))
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  #receive(response: EngineResponse): void {
    const request = this.#pending.get(response.requestId)
    if (!request) {
      return
    }

    this.#pending.delete(response.requestId)

    if (response.kind === 'error') {
      this.#diagnostic('error', response.message)
      request.reject(
        typeof response.message === 'string'
          ? new Error(response.message)
          : new TungstenMessageError(response.message),
      )
      return
    }

    try {
      for (const warning of 'warnings' in response ? (response.warnings ?? []) : [])
        this.#diagnostic('warning', warning)
      if (response.kind === 'delta') {
        if (this.#state && response.generation !== this.#generation) {
          request.resolve({ ...response, kind: 'patched', state: this.#state })
          return
        }
        if (
          this.#recovery?.generation === response.generation ||
          !this.#state ||
          response.generation !== this.#generation ||
          response.baseRevision !== this.#revision
        ) {
          // Recover explicitly; an ordinary update never includes a full snapshot.
          if (!this.#recovery) {
            const recovery = {
              generation: response.generation,
              effects: new Map<string, SourceEffect>(),
              snapshot: this.#request<SnapshotResponse>({ kind: 'snapshot' }),
            }
            this.#recovery = recovery
            recovery.snapshot = recovery.snapshot.then(
              (snapshot) => {
                if (snapshot.generation === recovery.generation && !this.#destroyed) {
                  const loading = new Set(
                    Object.values(snapshot.state.fields).flatMap(
                      (field) => field.loadingSources ?? [],
                    ),
                  )
                  this.#runEffects(
                    [...recovery.effects.values()].filter((effect) => loading.has(effect.id)),
                  )
                }
                if (this.#recovery === recovery) this.#recovery = null
                return snapshot
              },
              (error: unknown) => {
                if (this.#recovery === recovery) this.#recovery = null
                throw error
              },
            )
          }
          for (const effect of response.effects ?? []) this.#recovery.effects.set(effect.id, effect)
          void this.#recovery.snapshot
            .then((snapshot) =>
              request.resolve({
                ...response,
                ...snapshot,
                kind: 'patched',
                requestId: response.requestId,
                patches: response.patches,
              }),
            )
            .catch(request.reject)
          return
        }
        this.#revision = response.revision
        this.#state = applyFields(this.#state, response.fields)
        this.#publish(response)
        request.resolve({ ...response, kind: 'patched', state: this.#state })
        return
      }
      if ('state' in response) {
        if (response.generation !== undefined && response.generation !== this.#generation) {
          this.#files.reset()
          for (const fetch of this.#fetches.values()) fetch.controller.abort()
          this.#fetches.clear()
        }
        if (this.#state && response.generation === this.#generation)
          response.state = reconcileState(this.#state, response.state)
        this.#state = response.state
        this.#generation = response.generation ?? this.#generation
        this.#revision = response.revision ?? this.#revision
        this.#handles = response.handles ?? this.#handles
        if (response.kind === 'loaded') this.#schema = response.schema
        if (this.#schema && response.kind !== 'validated')
          this.#fileFields = fieldsOf(this.#schema.form, this.#state).filter(
            (field) => fieldTypeOf(field) === 'file',
          )
        this.#publish(response)
      }
      request.resolve(response)
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  #publish(metadata: IntegrationMetadata): void {
    const recovery = this.#recovery
    if (recovery && recovery.generation === metadata.generation)
      for (const effect of metadata.effects ?? []) recovery.effects.set(effect.id, effect)
    const changed =
      'fields' in metadata
        ? Object.keys((metadata as import('./protocol.js').DeltaResponse).fields)
        : undefined
    this.#files.prune(changed)
    if (this.#state)
      for (const listener of this.#listeners) {
        try {
          listener(this.#state)
        } catch (error) {
          console.error('Tungsten state observer failed', error)
        }
      }
    if (this.#state) {
      for (const listener of this.#changeListeners) {
        try {
          listener(this.#state, changed)
        } catch (error) {
          console.error('Tungsten state observer failed', error)
        }
      }
    }
    this.#runEffects(metadata.effects ?? [])
  }
  #runEffects(effects: SourceEffect[]): void {
    if (!this.#fetchSources) return
    const generation = this.#generation
    for (const effect of effects) {
      const previous = this.#fetches.get(effect.id)
      if (previous?.revision === effect.revision) continue
      previous?.controller.abort()
      const controller = new AbortController()
      const request = { revision: effect.revision, controller }
      this.#fetches.set(effect.id, request)
      const run = async () => {
        try {
          const definition = Object.hasOwn(this.#sources, effect.source)
            ? this.#sources[effect.source]
            : undefined
          if (!definition)
            throw new Error(
              JSON.stringify({
                messageKey: 'tg_api_data_source_is_not_configured',
                params: { p0: effect.source },
              }),
            )
          const data = await fetchSource(this.#api, definition, effect, controller.signal)
          if (this.#destroyed || controller.signal.aborted || this.#generation !== generation)
            return
          await this.integrate(generation, {
            kind: 'source',
            command: { kind: 'resolve', id: effect.id, revision: effect.revision, data },
          })
        } catch (error) {
          if (this.#destroyed || controller.signal.aborted || this.#generation !== generation)
            return
          await this.integrate(generation, {
            kind: 'source',
            command: {
              kind: 'fail',
              id: effect.id,
              revision: effect.revision,
              message: error instanceof Error ? error.message : String(error),
            },
          })
        } finally {
          if (this.#fetches.get(effect.id) === request) this.#fetches.delete(effect.id)
        }
      }
      void run().catch(() => {})
    }
  }

  #rejectAll(error: Error): void {
    for (const request of this.#pending.values()) {
      request.reject(error)
    }
    this.#pending.clear()
  }
}

/** Discover the actual worker/core registry without installing a form. */
export async function getAuthoringCatalog() {
  const client = new EngineClient()
  try {
    return (await client.catalog()).catalog
  } finally {
    client.destroy()
  }
}
