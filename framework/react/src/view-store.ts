import type { FormState, RuntimeFieldState } from '../../../api/src/types.js'

import { fieldOf, fieldKeys, sameValue } from '../../../api/src/engine/snapshots.js'

function blocked(field: RuntimeFieldState | undefined): number {
  return field &&
    !field.hidden &&
    !field.disabled &&
    (field.errors.length ||
      field.loadingSources?.length ||
      Object.keys(field.sourceErrors ?? {}).length ||
      field.unresolved ||
      field.uploading ||
      field.uploadError)
    ? 1
    : 0
}

type Listener = () => void
export type ViewLayout = NonNullable<FormState['repeaters']> | null

/** A view of immutable client snapshots. Only subscribed, affected keys notify. */
export class FormViewStore {
  state: FormState = { fields: {} }
  #flat = this.state
  #invalid = 0
  #invalidCollections = 0
  contentRevision = 0
  get valid(): boolean {
    return this.#invalid === 0 && this.#invalidCollections === 0
  }
  readonly #layouts = new WeakMap<NonNullable<FormState['repeaters']>, FormState>()
  readonly fields = new Map<string, Set<Listener>>()
  readonly errors = new Map<string, Set<ErrorCounts>>()

  update(state: FormState, changed?: readonly string[]): void {
    if (state === this.state) return
    const previous = this.state
    this.state = state
    if (state.repeaters) this.#layouts.set(state.repeaters, state)
    else this.#flat = state
    const fullKeys = changed ?? new Set([...fieldKeys(previous), ...fieldKeys(state)])
    let contentChanged = false
    for (const key of fullKeys) {
      const old = fieldOf(previous, key),
        next = fieldOf(state, key)
      this.#invalid += blocked(next) - blocked(old)
      if (!old || !next || !sameValue(old.value, next.value)) contentChanged = true
    }
    if (state.repeaters !== previous.repeaters) {
      this.#invalidCollections = Object.values(state.repeaters ?? {}).filter(
        (collection) => collection.errors.length,
      ).length
      const old = previous.repeaters ?? {},
        next = state.repeaters ?? {}
      if (
        Object.keys(old).length !== Object.keys(next).length ||
        Object.keys(next).some((key) => old[key]?.length !== next[key].length)
      )
        contentChanged = true
    }
    if (contentChanged) this.contentRevision++
    // Old layouts keep their matching view until the host commits the replacement.
    if (state.repeaters !== previous.repeaters) return
    const keys = changed ?? new Set([...this.fields.keys(), ...this.errors.keys()])
    const notify = new Set<Listener>()
    const counts = new Map<ErrorCounts, Map<string, number>>()
    for (const key of keys) {
      const next = fieldOf(state, key),
        old = fieldOf(previous, key)
      if (next === old) continue
      for (const listener of this.fields.get(key) ?? []) notify.add(listener)
      const difference = (next?.errors.length ?? 0) - (old?.errors.length ?? 0)
      if (!difference) continue
      for (const scope of this.errors.get(key) ?? []) {
        if (scope.layout !== (state.repeaters ?? null)) continue
        let changes = counts.get(scope)
        if (!changes) counts.set(scope, (changes = new Map()))
        changes.set(key, difference)
      }
    }
    // Install every aggregate before notifying any view: selectors always read
    // one completed snapshot, including when several fields change together.
    for (const [scope, changes] of counts) scope.update(changes)
    for (const scope of counts.keys()) for (const listener of scope.listeners) notify.add(listener)
    for (const listener of notify) listener()
  }
  snapshot(layout: ViewLayout = this.state.repeaters ?? null): FormState {
    return layout ? (this.#layouts.get(layout) ?? this.state) : this.#flat
  }
  field(
    key: string,
    layout: ViewLayout = this.state.repeaters ?? null,
  ): RuntimeFieldState | undefined {
    return fieldOf(this.snapshot(layout), key)
  }
  subscribe(key: string, listener: Listener): () => void {
    let listeners = this.fields.get(key)
    if (!listeners) this.fields.set(key, (listeners = new Set()))
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.fields.delete(key)
    }
  }
  errorCounts(
    groups: readonly (readonly string[])[],
    layout: ViewLayout = this.state.repeaters ?? null,
  ): ErrorCounts {
    return new ErrorCounts(this, groups, layout)
  }
}

export class ErrorCounts {
  readonly listeners = new Set<Listener>()
  readonly #indices = new Map<string, number[]>()
  #state: FormState
  #snapshot: readonly number[]
  private readonly store: FormViewStore
  private readonly groups: readonly (readonly string[])[]
  readonly layout: ViewLayout
  constructor(store: FormViewStore, groups: readonly (readonly string[])[], layout: ViewLayout) {
    this.layout = layout
    this.store = store
    this.groups = groups
    groups.forEach((keys, index) => {
      for (const key of keys) {
        const indices = this.#indices.get(key) ?? []
        indices.push(index)
        this.#indices.set(key, indices)
      }
    })
    this.#state = store.snapshot(layout)
    this.#snapshot = this.#read()
  }
  #read(): number[] {
    return this.groups.map((keys) =>
      keys.reduce(
        (count, key) => count + (this.store.field(key, this.layout)?.errors.length ?? 0),
        0,
      ),
    )
  }
  snapshot = (): readonly number[] => {
    if (!this.listeners.size && this.#state !== this.store.snapshot(this.layout)) {
      this.#state = this.store.snapshot(this.layout)
      this.#snapshot = this.#read()
    }
    return this.#snapshot
  }
  subscribe = (listener: Listener): (() => void) => {
    this.snapshot()
    if (!this.listeners.size) {
      for (const key of this.#indices.keys()) {
        let scopes = this.store.errors.get(key)
        if (!scopes) this.store.errors.set(key, (scopes = new Set()))
        scopes.add(this)
      }
    }
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size) return
      for (const key of this.#indices.keys()) {
        const scopes = this.store.errors.get(key)!
        scopes.delete(this)
        if (!scopes.size) this.store.errors.delete(key)
      }
    }
  }
  update(changes: ReadonlyMap<string, number>): void {
    const next = [...this.#snapshot]
    for (const [key, difference] of changes)
      for (const index of this.#indices.get(key)!) next[index] += difference
    this.#state = this.store.snapshot(this.layout)
    this.#snapshot = next
  }
}
