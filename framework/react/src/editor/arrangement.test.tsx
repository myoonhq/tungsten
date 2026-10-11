import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EngineRuntime, initSync } from '../../../../api/src/wasm/tungsten_core.js'
import type { AuthoringCatalog, TungstenComponent, TungstenSchema } from '../types.js'
import { arrange, dropProblem } from './arrangement.js'
import { initialValuesTemplate } from './initial-values.js'
import { componentAt } from './model.js'

let catalog: AuthoringCatalog
const runtimes: EngineRuntime[] = []
function engine() {
  const runtime = new EngineRuntime()
  runtimes.push(runtime)
  return runtime
}
function load(schema: TungstenSchema) {
  const runtime = engine()
  runtime.load_form(JSON.stringify(schema))
  return runtime
}
beforeAll(() => {
  initSync({ module: readFileSync('api/src/wasm/tungsten_core_bg.wasm') })
  catalog = JSON.parse(engine().get_catalog())
})
afterEach(() => runtimes.splice(0).forEach((runtime) => runtime.free()))
const group = (key: string, children: readonly TungstenComponent[] = []): TungstenComponent => ({
  type: 'group',
  key,
  variant: 'basic',
  render: { type: 'group', settings: {} },
  subform: children,
})
const repeater = (key: string, children: readonly TungstenComponent[] = []): TungstenComponent => ({
  type: 'repeater',
  key,
  render: { type: 'undereachother', settings: {} },
  template: children,
})
const schema = (form: readonly TungstenComponent[]): TungstenSchema => ({
  schemaVersion: 'sprout',
  form,
})

describe('editor arrangement', () => {
  it('drops registered fields into nested groups and repeater templates with unique keys', () => {
    const document = schema([group('g', [repeater('g.people')])])
    const first = arrange(
      document,
      { kind: 'palette', type: 'text' },
      { parent: [0, 0], index: 0 },
      catalog,
    )
    const second = arrange(
      first.schema,
      { kind: 'palette', type: 'text' },
      { parent: [0, 0], index: 0 },
      catalog,
    )
    expect(first.selection).toEqual([0, 0, 0])
    expect(componentAt(second.schema, [0, 0, 0])?.key).toBe('g.people.text2')
    expect(componentAt(second.schema, [0, 0, 1])?.key).toBe('g.people.text1')
    load(second.schema)
    expect(document).toEqual(schema([group('g', [repeater('g.people')])]))
  })
  it('rebases a moved subtree and external references while correcting shifted target indexes', () => {
    const document = schema([
      group('old', [{ type: 'text', key: 'old.name', current_value: 'Ada' }]),
      group('target'),
      {
        type: 'boolean',
        key: 'outside',
        rules: [
          {
            when: { property: 'old.name', operation: 'Eq', value: 'Ada' },
            then: [{ kind: 'set_value', value: true }],
          },
        ],
      },
    ])
    const moved = arrange(
      document,
      { kind: 'component', path: [0] },
      { parent: [1], index: 0 },
      catalog,
    )
    expect(moved.selection).toEqual([0, 0])
    expect(componentAt(moved.schema, moved.selection)?.key).toBe('target.old')
    expect(componentAt(moved.schema, [0, 0, 0])).toMatchObject({
      key: 'target.old.name',
      current_value: 'Ada',
    })
    expect(JSON.parse(load(moved.schema).get_values()).outside).toBe(true)
  })
  it('reorders in both directions without changing canonical keys or settings', () => {
    const document = schema([
      { type: 'text', key: 'flat.name', current_value: 'Ada' },
      { type: 'number', key: 'count', current_value: 0 },
      group('g'),
    ])
    const down = arrange(
      document,
      { kind: 'component', path: [0] },
      { parent: [], index: 3 },
      catalog,
    )
    expect(down.schema.form.map((entry) => entry.key)).toEqual(['count', 'g', 'flat.name'])
    const up = arrange(
      down.schema,
      { kind: 'component', path: [2] },
      { parent: [], index: 0 },
      catalog,
    )
    expect(up.schema).toMatchObject(document)
    expect(
      arrange(document, { kind: 'component', path: [0] }, { parent: [], index: 1 }, catalog).schema,
    ).toBe(document)
    load(up.schema)
  })
  it('checks collisions across all moved descendant keys', () => {
    const document = schema([
      group('g', [group('g.contact', [{ type: 'text', key: 'g.contact.name' }])]),
      { type: 'text', key: 'contact.name' },
    ])
    const moved = arrange(
      document,
      { kind: 'component', path: [0, 0] },
      { parent: [], index: 2 },
      catalog,
    )
    expect(componentAt(moved.schema, [2, 0])?.key).toBe('contact2.name')
    load(moved.schema)
  })
  it('refuses self/descendant moves and invalid section children', () => {
    const document = schema([
      group('g', [repeater('g.r')]),
      {
        type: 'group',
        key: 'tabs',
        variant: 'sectioned',
        render: { type: 'tabs', settings: {} },
        subform: [],
      },
    ])
    expect(
      dropProblem(document, { kind: 'component', path: [0] }, { parent: [0, 0], index: 0 }),
    ).toContain('itself')
    expect(() =>
      arrange(document, { kind: 'palette', type: 'text' }, { parent: [1], index: 0 }, catalog),
    ).toThrow('tg_editor_sectioned_layouts_contain_basic_groups_drop_a_group_here_first')
    load(
      arrange(document, { kind: 'palette', type: 'group' }, { parent: [1], index: 0 }, catalog)
        .schema,
    )
    expect(document.form).toHaveLength(2)
  })
  it('moves sample data within the same collection and drops only affected samples across collections', () => {
    const document = schema([
      {
        ...repeater('people', [
          { type: 'text', key: 'people.name' },
          group('people.details'),
          repeater('people.children', [{ type: 'text', key: 'people.children.name' }]),
        ]),
        current_value: [{ name: 'Ada', children: [{ name: 'Grace' }] }],
      },
    ])
    const withinCollection = arrange(
      document,
      { kind: 'component', path: [0, 0] },
      { parent: [0, 1], index: 0 },
      catalog,
    )
    expect(JSON.parse(load(withinCollection.schema).get_values()).people).toEqual([
      { details: { name: 'Ada' }, children: [{ name: 'Grace' }] },
    ])
    const across = arrange(
      document,
      { kind: 'component', path: [0, 0] },
      { parent: [0, 2], index: 1 },
      catalog,
    )
    expect(JSON.parse(load(across.schema).get_values()).people).toEqual([
      { children: [{ name: 'Grace', name2: null }] },
    ])
    expect(document.form[0].current_value).toEqual([{ name: 'Ada', children: [{ name: 'Grace' }] }])
  })
  it('resets a moved-out initial section while preserving references to moved fields', () => {
    const document = schema([
      {
        type: 'group',
        key: 'tabs',
        variant: 'sectioned',
        render: { type: 'tabs', settings: { initialSection: 'tabs.a' } },
        subform: [group('tabs.a'), group('tabs.b')],
      },
    ])
    const moved = arrange(
      document,
      { kind: 'component', path: [0, 0] },
      { parent: [], index: 1 },
      catalog,
    )
    expect(moved.schema.form[0]).toMatchObject({ render: { settings: {} } })
    load(moved.schema)
  })
})

describe('initial input template', () => {
  it('fills canonical scalar keys and nested sample arrays while preserving falsy defaults', () => {
    const document = schema([
      group('contact', [
        { type: 'boolean', key: 'contact.enabled', current_value: false },
        { type: 'number', key: 'contact.count', current_value: 0 },
      ]),
      repeater('people', [
        { type: 'text', key: 'people.name' },
        group('people.address', [{ type: 'text', key: 'people.address.city' }]),
        repeater('people.children', [{ type: 'text', key: 'people.children.name' }]),
      ]),
    ])
    const values = initialValuesTemplate(document)
    expect(values).toEqual({
      'contact.enabled': false,
      'contact.count': 0,
      people: [{ name: null, address: { city: null }, children: [{ name: null }] }],
    })
    const runtime = engine()
    runtime.load_form_with_values(JSON.stringify(document), JSON.stringify(values), false)
    expect(JSON.parse(runtime.get_values())).toEqual(values)
  })
  it('merges supplied data, preserves explicitly empty collections and includes new keys', () => {
    const document = schema([
      repeater('people', [
        { type: 'text', key: 'people.name' },
        { type: 'number', key: 'people.age' },
        repeater('people.children', [{ type: 'text', key: 'people.children.name' }]),
      ]),
    ])
    expect(initialValuesTemplate(document, { people: [] })).toEqual({ people: [] })
    expect(initialValuesTemplate(document, { people: [{ name: 'Ada', children: [] }] })).toEqual({
      people: [{ name: 'Ada', age: null, children: [] }],
    })
  })
  it('keeps nested defaults and never treats prototype property names as object state', () => {
    const document = schema([
      {
        ...repeater('people', [
          { type: 'text', key: 'people.name' },
          repeater('people.children', [{ type: 'text', key: 'people.children.name' }]),
        ]),
        current_value: [{ name: 'Ada', children: [{ name: 'Grace' }] }],
      },
      repeater('other', [{ type: 'text', key: 'other.__proto__.name' }]),
    ])
    const values = initialValuesTemplate(document)
    expect(values.people).toEqual([{ name: 'Ada', children: [{ name: 'Grace' }] }])
    expect(JSON.stringify(values)).toContain('"__proto__":{"name":null}')
    expect(({} as Record<string, unknown>).name).toBeUndefined()
  })
})
