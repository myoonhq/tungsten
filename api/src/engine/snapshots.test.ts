import { expect, it } from 'vitest'
import { applyFields, fieldOf, fieldKeys, reconcileState } from './snapshots.js'
import type { FormState } from '../types.js'

it('retains immutable previous snapshots across pages and ordinary JSON/clone/enumeration behavior', () => {
  const initial: FormState = {
    fields: Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`f${i}`, { value: i, hidden: false, errors: [] }]),
    ),
  }
  Object.freeze(initial.fields)
  const first = applyFields(initial, { f0: { value: 'one', hidden: false, errors: [] } })
  Object.freeze(first)
  const second = applyFields(first, {
    f0: { value: 'two', hidden: false, errors: [] },
    f999: { value: null, hidden: false, errors: [] },
  })
  expect(fieldOf(first, 'f0')?.value).toBe('one')
  expect(fieldOf(second, 'f0')?.value).toBe('two')
  expect(fieldOf(second, 'f999')?.value).toBeNull()
  expect(fieldOf(second, 'f500')).toBe(initial.fields.f500)
  expect(fieldKeys(second)).toHaveLength(1000)
  expect(Object.keys(second.fields)).toHaveLength(1000)
  expect(structuredClone(second)).toEqual(JSON.parse(JSON.stringify(second)))
  expect(first.fields.f999.value).toBe(999)
})

it('does not materialize full records for field reads or another delta; equal options retain identity', () => {
  const options = [{ value: 'x', label: 'X' }]
  const initial: FormState = {
    fields: { choice: { value: null, hidden: false, errors: [], options } },
  }
  const first = applyFields(initial, {
    choice: { ...initial.fields.choice, value: 'x', options: structuredClone(options) },
  })
  const getter = Object.getOwnPropertyDescriptor(first, 'fields')!.get!
  let reads = 0
  Object.defineProperty(first, 'fields', {
    enumerable: true,
    get() {
      reads++
      return getter.call(first)
    },
  })
  expect(fieldOf(first, 'choice')?.options).toBe(options)
  expect(fieldOf(first, 'missing')).toBeUndefined()
  const second = applyFields(first, {
    choice: { value: null, hidden: false, errors: [], options: [{ value: 'y', label: 'Y' }] },
  })
  expect(fieldOf(second, 'choice')?.options).toEqual([{ value: 'y', label: 'Y' }])
  expect(reads).toBe(0)
  expect(structuredClone(first).fields.choice.value).toBe('x')
  expect(reads).toBe(1)
})

it('preserves unchanged field/options and collection identities in full snapshots', () => {
  const previous: FormState = {
    fields: {
      name: { value: 'Ada', errors: [], hidden: false },
      choice: { value: 'a', errors: [], hidden: false, options: [{ value: 'a', label: 'A' }] },
    },
    repeaters: { people: { length: 0, instances: [], errors: [], canAdd: true } },
  }
  const incoming = structuredClone(previous)
  incoming.fields.choice.value = null
  const reconciled = reconcileState(previous, incoming)
  expect(reconciled.fields.name).toBe(previous.fields.name)
  expect(reconciled.fields.choice).not.toBe(previous.fields.choice)
  expect(reconciled.fields.choice.options).toBe(previous.fields.choice.options)
  expect(reconciled.repeaters).toBe(previous.repeaters)
  expect(reconciled).toEqual(incoming)
  expect(previous.fields.choice.value).toBe('a')
})
