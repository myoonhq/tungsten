import type { FormState, RuntimeFieldState } from '../types.js'

/** JSON-domain equality, scoped to changed values/options, never the entire form. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  )
}

const pageSize = 128
const snapshots = new WeakMap<FormState, FieldSnapshot>()

/** Copy small changed pages; materialize an ordinary public record only on access.
 * No proxies, prototype overlays or mutable published snapshots are involved.
 * The page directory is copied too (one entry per 128 fields), not claimed O(1).
 */
class FieldSnapshot {
  readonly keys: readonly string[]
  readonly indices: ReadonlyMap<string, number>
  readonly pages: readonly (readonly RuntimeFieldState[])[]
  private record?: FormState['fields']
  constructor(
    keys: readonly string[],
    indices: ReadonlyMap<string, number>,
    pages: readonly (readonly RuntimeFieldState[])[],
    record?: FormState['fields'],
  ) {
    this.keys = keys
    this.indices = indices
    this.pages = pages
    this.record = record
  }
  field(key: string): RuntimeFieldState | undefined {
    const index = this.indices.get(key)
    return index === undefined
      ? undefined
      : this.pages[Math.floor(index / pageSize)][index % pageSize]
  }
  materialize(): FormState['fields'] {
    return (this.record ??= Object.fromEntries(this.keys.map((key) => [key, this.field(key)!])))
  }
}
function index(state: FormState): FieldSnapshot {
  let snapshot = snapshots.get(state)
  if (!snapshot) {
    const keys = Object.keys(state.fields)
    const pages: RuntimeFieldState[][] = []
    keys.forEach((key, i) => (pages[Math.floor(i / pageSize)] ??= []).push(state.fields[key]))
    snapshot = new FieldSnapshot(keys, new Map(keys.map((key, i) => [key, i])), pages, state.fields)
    snapshots.set(state, snapshot)
  }
  return snapshot
}
export function fieldOf(state: FormState, key: string): RuntimeFieldState | undefined {
  const snapshot = snapshots.get(state)
  return snapshot ? snapshot.field(key) : state.fields[key]
}
export function fieldKeys(state: FormState): readonly string[] {
  return index(state).keys
}
export function applyFields(previous: FormState, changes: FormState['fields']): FormState {
  const before = index(previous)
  const keys = Object.keys(changes)
  if (keys.some((key) => !before.indices.has(key)))
    return { ...previous, fields: { ...previous.fields, ...changes } }
  const pages = [...before.pages]
  const copied = new Map<number, RuntimeFieldState[]>()
  for (const key of keys) {
    const i = before.indices.get(key)!,
      page = Math.floor(i / pageSize)
    let entries = copied.get(page)
    if (!entries) {
      entries = [...pages[page]]
      copied.set(page, entries)
      pages[page] = entries
    }
    const old = before.field(key),
      next = changes[key]
    // Stable option identity lets renderers reuse derived work on value-only echoes.
    // Fetching and source revision handling remain unchanged.
    entries[i % pageSize] =
      old?.options && sameValue(old.options, next.options)
        ? { ...next, options: old.options }
        : next
  }
  const snapshot = new FieldSnapshot(before.keys, before.indices, pages)
  const state: FormState = {
    get fields() {
      return snapshot.materialize()
    },
    ...(previous.repeaters ? { repeaters: previous.repeaters } : {}),
  }
  snapshots.set(state, snapshot)
  return state
}

/** Full operations necessarily inspect all fields. Preserve unchanged object
 * identities so a structural snapshot does not invalidate unrelated renderers.
 * Published snapshots remain immutable, and source requests are never cached.
 */
export function reconcileState(previous: FormState, next: FormState): FormState {
  const fields = Object.fromEntries(
    Object.entries(next.fields).map(([key, field]) => {
      const old = fieldOf(previous, key)
      return [
        key,
        sameValue(old, field)
          ? old!
          : old?.options && sameValue(old.options, field.options)
            ? { ...field, options: old.options }
            : field,
      ]
    }),
  )
  const repeaters =
    next.repeaters &&
    Object.fromEntries(
      Object.entries(next.repeaters).map(([key, collection]) => {
        const old = previous.repeaters?.[key]
        const instances = new Map(old?.instances.map((instance) => [instance.id, instance]))
        const normalized = {
          ...collection,
          instances: collection.instances.map((instance) => {
            const before = instances.get(instance.id)
            return sameValue(before, instance) ? before! : instance
          }),
        }
        return [key, sameValue(old, normalized) ? old! : normalized]
      }),
    )
  const state: FormState = {
    fields,
    ...(repeaters
      ? {
          repeaters: sameValue(previous.repeaters, repeaters) ? previous.repeaters : repeaters,
        }
      : {}),
  }
  return state
}
