import { isGroup, isRepeater } from '../../../../api/src/types.js'
import type { RepeaterItem, TungstenComponent, TungstenSchema, TungstenValues } from '../types.js'

type Data = Record<string, unknown>
const object = (value: unknown): value is Data =>
  !!value && typeof value === 'object' && !Array.isArray(value)
function read(data: Data, path: readonly string[]): { present: boolean; value?: unknown } {
  let value: unknown = data
  for (const key of path) {
    if (!object(value) || !Object.hasOwn(value, key)) return { present: false }
    value = value[key]
  }
  return { present: true, value }
}
function write(data: Data, path: readonly string[], value: unknown) {
  let parent = data
  for (const key of path.slice(0, -1)) {
    const next = Object.hasOwn(parent, key) && object(parent[key]) ? { ...parent[key] } : {}
    Object.defineProperty(parent, key, {
      value: next,
      writable: true,
      enumerable: true,
      configurable: true,
    })
    parent = next
  }
  Object.defineProperty(parent, path.at(-1)!, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}
/** Editable input example, independent of evaluated/rule-derived preview state. */
export function initialValuesTemplate(
  schema: TungstenSchema,
  supplied: TungstenValues | null = null,
): TungstenValues {
  function fill(components: readonly TungstenComponent[], input: Data, owner?: string): Data {
    let output = { ...input }
    for (const component of components) {
      if (isGroup(component)) {
        output = fill(component.subform, output, owner)
        continue
      }
      const path = owner ? component.key.slice(owner.length + 1).split('.') : [component.key]
      const existing = read(input, path)
      if (isRepeater(component)) {
        // Preserve explicitly supplied empty arrays. Unsupplied collections show
        // one example item so their template's keys can actually be edited.
        const items = existing.present
          ? existing.value
          : component.current_value?.length
            ? component.current_value
            : [{}]
        write(
          output,
          path,
          Array.isArray(items)
            ? items.map((item) =>
                object(item) ? fill(component.template, item, component.key) : item,
              )
            : items,
        )
      } else
        write(output, path, existing.present ? existing.value : (component.current_value ?? null))
    }
    return output
  }
  return fill(schema.form, supplied ?? {}) as TungstenValues
}

function remove(data: Data, path: readonly string[]) {
  const key = path[0]
  if (!Object.hasOwn(data, key)) return
  if (path.length === 1) {
    delete data[key]
    return
  }
  const value = data[key]
  if (Array.isArray(value))
    value.forEach((item) => {
      if (object(item)) remove(item, path.slice(1))
    })
  else if (object(value)) {
    remove(value, path.slice(1))
    if (!Object.keys(value).length) delete data[key]
  }
}
function relocate(data: Data, from: readonly string[], to: readonly string[]) {
  // Shared collection paths are traversed per item, without inventing a mapping
  // between distinct collections' cardinalities.
  if (from.length > 1 && to.length > 1 && from[0] === to[0]) {
    const value = Object.hasOwn(data, from[0]) ? data[from[0]] : undefined
    if (Array.isArray(value))
      value.forEach((item) => {
        if (object(item)) relocate(item, from.slice(1), to.slice(1))
      })
    else if (object(value)) relocate(value, from.slice(1), to.slice(1))
    return
  }
  const value = read(data, from)
  remove(data, from)
  if (value.present) write(data, to, value.value)
}
/** Keep schema sample arrays valid after an authored component changes owner. */
export function relocateCollectionDefaults(
  schema: TungstenSchema,
  from: string,
  to: string,
  sameCollections: boolean,
): TungstenSchema {
  function walk(components: readonly TungstenComponent[]): TungstenComponent[] {
    return components.map((component) => {
      if (isGroup(component)) return { ...component, subform: walk(component.subform) }
      if (!isRepeater(component)) return component
      let defaults = component.current_value
      if (defaults && from.startsWith(`${component.key}.`)) {
        const fromPath = from.slice(component.key.length + 1).split('.')
        const toPath = to.startsWith(`${component.key}.`)
          ? to.slice(component.key.length + 1).split('.')
          : null
        defaults = structuredClone(defaults) as RepeaterItem[]
        for (const item of defaults) {
          if (sameCollections && toPath) relocate(item, fromPath, toPath)
          else remove(item, fromPath)
        }
      }
      return {
        ...component,
        ...(defaults ? { current_value: defaults } : {}),
        template: walk(component.template),
      }
    })
  }
  return { ...schema, form: walk(schema.form) }
}
