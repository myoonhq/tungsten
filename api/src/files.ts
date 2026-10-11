import { fieldOf } from './engine/snapshots.js'
import { ApiClient, ApiError, jsonPointer } from './http.js'
import type { FileReference, FileSettings, FileValue, FormState, TungstenField } from './types.js'
import type { IntegrationCommand } from './engine/protocol.js'
import { randomUUID } from './ids.js'

type FileHost = {
  state: () => FormState | null
  generation: () => string
  handle: (key: string) => string | undefined
  fileFields: () => readonly TungstenField[]
  integrate: (generation: string, command: IntegrationCommand) => Promise<unknown>
}
type Entry = { file: File; reserved: boolean; uploaded?: FileReference }
export class FileRegistry {
  readonly #files = new Map<string, Entry>()
  readonly #requests = new Map<string, Promise<void>>()
  #controller = new AbortController()
  readonly #references = new Map<string, readonly string[]>()
  private readonly host: FileHost
  private api: ApiClient
  constructor(host: FileHost, api: ApiClient) {
    this.host = host
    this.api = api
  }
  configure(api: ApiClient): void {
    this.api = api
  }
  reset(): void {
    this.#controller.abort()
    this.#controller = new AbortController()
    this.#files.clear()
    this.#requests.clear()
    this.#references.clear()
  }
  prune(changed?: readonly string[]): void {
    if (!this.#files.size) return
    const fields = this.host.fileFields()
    const keys = new Set(fields.map((field) => field.key))
    for (const key of this.#references.keys()) if (!keys.has(key)) this.#references.delete(key)
    const state = this.host.state()
    for (const key of changed ?? keys) {
      if (!keys.has(key)) continue
      const value = state && fieldOf(state, key)?.value
      this.#references.set(
        key,
        value && typeof value === 'object' && !Array.isArray(value)
          ? value.files.filter((file) => !file.uploaded).map((file) => file.id)
          : [],
      )
    }
    const pending = new Set([...this.#references.values()].flat())
    for (const [id, entry] of this.#files) {
      if (pending.has(id)) entry.reserved = false
      else if (!entry.reserved && !this.#requests.has(id)) this.#files.delete(id)
    }
  }
  select(files: readonly File[]): FileValue {
    return {
      files: files.map((file) => {
        const id = `tg-local-${randomUUID()}`
        this.#files.set(id, { file, reserved: true })
        return { id, name: file.name, size: file.size, mediaType: file.type, uploaded: false }
      }),
    }
  }
  discard(value: FileValue): void {
    for (const file of value.files) this.#files.delete(file.id)
  }
  async prepare(field: TungstenField): Promise<void> {
    const value = this.host.state() && fieldOf(this.host.state()!, field.key)?.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const handle = this.host.handle(field.key)
    const settings = field as TungstenField & FileSettings
    for (const reference of value.files) {
      if (reference.uploaded) continue
      let request = this.#requests.get(reference.id)
      if (!request) {
        request = this.#upload(field.key, reference, settings, handle)
        this.#requests.set(reference.id, request)
        void request
          .finally(() => {
            if (this.#requests.get(reference.id) === request) this.#requests.delete(reference.id)
            this.prune()
          })
          .catch(() => {})
      }
      await request
    }
  }
  async #upload(
    key: string,
    reference: FileReference,
    settings: FileSettings,
    handle: string | undefined,
  ): Promise<void> {
    const generation = this.host.generation(),
      signal = this.#controller.signal
    if (handle === undefined)
      throw new ApiError(
        'tg_api_file_field_has_no_stable_handle',
        'tg_api_file_field_has_no_stable_handle',
        undefined,
        {},
      )
    const update = (loading: boolean, error?: string, uploaded?: FileReference) =>
      this.host.integrate(generation, {
        kind: 'upload',
        handle,
        fileId: reference.id,
        loading,
        error,
        uploaded,
      })
    try {
      await update(true)
      signal.throwIfAborted()
      const entry = this.#files.get(reference.id)
      if (!entry)
        throw new ApiError('tg_file_missing_bytes', 'tg_file_missing_bytes', undefined, {})
      if (!entry.uploaded) {
        const body = new FormData()
        body.append(settings.upload.fieldName ?? 'file', entry.file, entry.file.name)
        const result = jsonPointer(
          await this.api.request(
            { ...settings.upload, method: settings.upload.method ?? 'POST' },
            { operation: 'upload', key, idempotencyKey: reference.id },
            { body, signal },
          ),
          settings.upload.resultPath,
        )
        if (
          !result ||
          typeof result !== 'object' ||
          !Object.hasOwn(result, 'id') ||
          typeof (result as { id: unknown }).id !== 'string' ||
          !(result as { id: string }).id.trim()
        )
          throw new ApiError('tg_file_invalid_response', 'tg_file_invalid_response', undefined, {})
        entry.uploaded = { ...reference, id: (result as { id: string }).id, uploaded: true }
      }
      signal.throwIfAborted()
      await update(false, undefined, entry.uploaded)
    } catch (error) {
      if (!signal.aborted && this.host.generation() === generation)
        await update(false, error instanceof Error ? error.message : String(error))
      throw error
    }
  }
}
