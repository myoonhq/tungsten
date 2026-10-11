import { ApiClient, type Endpoint, type TungstenConfig } from './http.js'
import type { TungstenValues } from './types.js'
import { randomUUID } from './ids.js'

export type OperationMetadata = {
  /** Unix milliseconds captured when the content revision is created. */
  timestamp: number
  revision: number
  writerId: string
}
export type OperationOutcome = Readonly<
  OperationMetadata & {
    status: 'success' | 'error'
    data?: unknown
    error?: unknown
  }
>
export type OperationStatus = 'idle' | 'dirty' | 'pending' | 'success' | 'error'
export type OperationContext = Readonly<
  OperationMetadata & { status?: 'success' | 'error'; data?: unknown; error?: unknown }
>
export type OperationHandler = (
  values: TungstenValues,
  context?: OperationContext,
) => void | Promise<void>
export type OperationSettings = { endpoint?: Endpoint; showStatus?: boolean }
export type AutosaveSettings = OperationSettings & { debounceMs?: number }

function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable)
    Object.freeze(value)
  }
  return value
}

/** Host operations are separate from core validation and may overlap. */
export class FormOperations {
  readonly #api: ApiClient
  readonly #writerId = randomUUID()
  readonly #controllers = new Set<AbortController>()
  #userEdited = false
  #revision = 0
  #signature: string | undefined
  #contentRevision: number | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #closed = false
  #submitRevision = 0
  readonly #debounce: number
  private readonly config: TungstenConfig
  private readonly handlers: { save?: OperationHandler; submit?: OperationHandler }
  private readonly onStatus: (
    operation: 'save' | 'submit',
    status: OperationStatus,
    outcome?: OperationOutcome,
  ) => void
  private readonly beforeSave?: (values: TungstenValues) => Promise<TungstenValues>
  constructor(
    config: TungstenConfig,
    handlers: { save?: OperationHandler; submit?: OperationHandler },
    onStatus: (
      operation: 'save' | 'submit',
      status: OperationStatus,
      outcome?: OperationOutcome,
    ) => void,
    beforeSave?: (values: TungstenValues) => Promise<TungstenValues>,
  ) {
    this.config = config
    this.handlers = handlers
    this.onStatus = onStatus
    this.beforeSave = beforeSave
    this.#api = new ApiClient(config)
    this.#debounce = config.autosave?.debounceMs ?? 200
    if (!Number.isFinite(this.#debounce) || this.#debounce < 0 || this.#debounce > 0x7fffffff)
      throw new Error('tg_api_invalid_debounce')
  }
  markEdited(): void {
    this.#userEdited = true
  }
  get saving(): boolean {
    return !!this.config.autosave?.endpoint || !!this.handlers.save
  }
  /** Mutable external values retain the original eager-capture contract. */
  observe(values: TungstenValues, initialSourceCompletion = false): void {
    if (this.#closed || !this.saving) return
    const signature = JSON.stringify(values)
    if (signature === this.#signature) return
    const initial = this.#signature === undefined
    this.#signature = signature
    if (initial || (initialSourceCompletion && this.#revision === 0 && !this.#userEdited)) return
    const captured = immutable(structuredClone(values))
    this.#schedule(() => captured)
  }
  /** The host supplies an immutable state revision; projection waits for debounce. */
  observeSnapshot(
    read: () => TungstenValues,
    contentRevision: number,
    initialSourceCompletion = false,
  ): void {
    if (this.#closed || !this.saving || contentRevision === this.#contentRevision) return
    const initial = this.#contentRevision === undefined
    this.#contentRevision = contentRevision
    if (initial || (initialSourceCompletion && this.#revision === 0 && !this.#userEdited)) return
    this.#schedule(() => immutable(structuredClone(read())))
  }
  #schedule(read: () => TungstenValues): void {
    this.#revision++
    if (this.config.autosave?.endpoint && this.config.autosave.showStatus !== false)
      this.onStatus('save', 'dirty')
    clearTimeout(this.#timer)
    const metadata = immutable({
      timestamp: Date.now(),
      revision: this.#revision,
      writerId: this.#writerId,
    })
    this.#timer = setTimeout(() => {
      if (this.#closed || metadata.revision !== this.#revision) return
      const captured = read()
      // Retain compatibility with a preparation callback returning durable values.
      this.#signature = JSON.stringify(captured)
      void this.#save(captured, metadata)
    }, this.#debounce)
  }
  async #save(values: TungstenValues, metadata: OperationMetadata): Promise<void> {
    // An upload may turn browser-only files into durable references and publish
    // another content revision. Never save its obsolete pre-upload capture.
    try {
      if (this.#closed || metadata.revision !== this.#revision) return
      if (this.beforeSave) {
        const prepared = await this.beforeSave(values)
        if (this.#closed || metadata.revision !== this.#revision) return
        if (prepared !== values && JSON.stringify(prepared) !== JSON.stringify(values)) {
          this.observe(prepared)
          return
        }
      }
      if (this.#closed || metadata.revision !== this.#revision) return
      await this.#run('save', values, metadata, this.config.autosave, this.handlers.save)
    } catch (error) {
      if (!this.#closed && metadata.revision === this.#revision) {
        const outcome = immutable({ ...metadata, status: 'error' as const, error })
        if (this.config.autosave?.endpoint && this.config.autosave.showStatus !== false)
          this.onStatus('save', 'error', outcome)
        if (this.config.autosave?.endpoint && this.handlers.save) {
          try {
            await this.handlers.save(values, outcome)
          } catch (observerError) {
            console.error('tg_api_operation_observer_failed', observerError)
          }
        }
      }
    }
  }
  async submit(values: TungstenValues): Promise<OperationOutcome> {
    return this.#run(
      'submit',
      immutable(structuredClone(values)),
      immutable({
        timestamp: Date.now(),
        revision: ++this.#submitRevision,
        writerId: this.#writerId,
      }),
      this.config.submission,
      this.handlers.submit,
    )
  }
  async #run(
    operation: 'save' | 'submit',
    values: TungstenValues,
    metadata: OperationMetadata,
    settings: OperationSettings | undefined,
    handler: OperationHandler | undefined,
  ): Promise<OperationOutcome> {
    const controller = new AbortController()
    this.#controllers.add(controller)
    const current = () =>
      !this.#closed &&
      metadata.revision === (operation === 'save' ? this.#revision : this.#submitRevision)
    const show = !!settings?.endpoint && settings.showStatus !== false
    if (show && current()) this.onStatus(operation, 'pending')
    let outcome: OperationOutcome
    try {
      if (settings?.endpoint) {
        const data = await this.#api.request(
          { ...settings.endpoint, method: settings.endpoint.method ?? 'POST' },
          {
            operation,
            key: operation,
            idempotencyKey: `${metadata.writerId}:${operation}:${metadata.revision}`,
          },
          { signal: controller.signal, body: { values, ...metadata } },
        )
        outcome = immutable({ ...metadata, status: 'success', data })
      } else {
        if (operation === 'save') await handler?.(values, metadata)
        else await handler?.(values)
        outcome = immutable({ ...metadata, status: 'success' })
      }
    } catch (error) {
      outcome = immutable({ ...metadata, status: 'error', error })
    } finally {
      this.#controllers.delete(controller)
    }
    if (show && current()) this.onStatus(operation, outcome.status, outcome)
    // Endpoint observers cannot change the HTTP outcome. Host handlers have
    // already settled above when there is no configured endpoint.
    if (settings?.endpoint && handler && !this.#closed) {
      try {
        await handler(values, outcome)
      } catch (error) {
        console.error('tg_api_operation_observer_failed', error)
      }
    }
    return outcome
  }
  close(): void {
    this.#closed = true
    clearTimeout(this.#timer)
    for (const controller of this.#controllers) controller.abort()
    this.#controllers.clear()
  }
}
