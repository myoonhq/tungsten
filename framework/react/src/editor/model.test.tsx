import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EngineRuntime, initSync } from '../../../../api/src/wasm/tungsten_core.js'
import type {
  AuthoringCatalog,
  RepeaterItem,
  TungstenComponent,
  TungstenSchema,
  TungstenValues,
} from '../types.js'
import { applyInspector, childrenOf, inspector, parseSchema, renameSchema } from './model.js'

let catalog: AuthoringCatalog
const runtimes: EngineRuntime[] = []
function runtime() {
  const engine = new EngineRuntime()
  engine.set_processing_limit(1000) // Inspector forms have a larger, bounded dependency graph.
  runtimes.push(engine)
  return engine
}
function load(schema: TungstenSchema, values: TungstenValues | null = null) {
  const engine = runtime()
  engine.load_form_with_values(JSON.stringify(schema), JSON.stringify(values), false)
  return engine
}
function roundTrip(schema: TungstenSchema, path: readonly number[]) {
  const component = path.reduce<TungstenComponent | undefined>(
    (node, index) => (node ? childrenOf(node)[index] : schema.form[index]),
    undefined,
  )
  const editor = inspector(component, schema, catalog)
  const engine = load(editor.schema, editor.values)
  return { values: JSON.parse(engine.get_values()) as TungstenValues, editor }
}
beforeAll(() => {
  initSync({ module: readFileSync('api/src/wasm/tungsten_core_bg.wasm') })
  catalog = JSON.parse(runtime().get_catalog())
})
afterEach(() => {
  runtimes.splice(0).forEach((engine) => engine.free())
})

const schema: TungstenSchema = {
  schemaVersion: 'sprout',
  form: [
    { type: 'boolean', key: 'enabled', current_value: true },
    {
      type: 'text',
      key: 'name',
      validators: [{ kind: 'required' }, { kind: 'min_length', value: 2 }],
      current_value: 'Ada',
      rules: [
        {
          when: { property: 'enabled', operation: 'Eq', value: true },
          then: [{ kind: 'show' }, { kind: 'clear_value' }],
        },
      ],
    },
  ],
}
describe('core-backed editor authoring', () => {
  it('round-trips temporal mode, timezone, DST policy, defaults and bounds', () => {
    const document: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'date',
          key: 'meeting',
          mode: 'datetime',
          timeZone: 'Europe/Bratislava',
          disambiguation: 'later',
          current_value: '2026-10-07T09:30:00+02:00',
          validators: [
            { kind: 'required' },
            { kind: 'min', value: '2026-01-01T00:00:00Z' },
            { kind: 'max', value: '2026-12-31T23:59:59Z' },
          ],
        },
      ],
    }
    const { values } = roundTrip(document, [0])
    const updated = applyInspector(document, [0], values, catalog)
    expect(updated.form[0]).toMatchObject(document.form[0])
    expect(JSON.parse(load(updated).get_values()).meeting).toBe('2026-10-07T07:30:00Z')
  })
  it('discovers metadata before form initialization and compiles every settings inspector', () => {
    expect(catalog.fields.map((field) => field.type)).toEqual([
      'text',
      'number',
      'boolean',
      'select',
      'file',
      'date',
    ])
    expect(catalog.groupRenderers).toHaveLength(22)
    for (const field of catalog.fields) {
      const document: TungstenSchema = {
        schemaVersion: 'sprout',
        form: [
          {
            type: field.type,
            key: 'value',
            ...(field.type === 'file' ? { upload: { api: 'main', endpoint: 'files' } } : {}),
          },
        ],
      }
      const { values } = roundTrip(document, [0])
      load(applyInspector(document, [0], values, catalog))
    }
    for (const renderer of catalog.groupRenderers) {
      const component: TungstenComponent = {
        type: 'group',
        key: 'section',
        variant: renderer.variant!,
        render: { type: renderer.type, settings: {} },
        subform: [],
      }
      roundTrip({ schemaVersion: 'sprout', form: [component] }, [0])
    }
    for (const renderer of catalog.repeaterRenderers) {
      const component: TungstenComponent = {
        type: 'repeater',
        key: 'items',
        render: { type: renderer.type, settings: {} },
        template: [{ type: 'text', key: 'items.name' }],
      }
      const document = { schemaVersion: 'sprout', form: [component] }
      const { values } = roundTrip(document, [0])
      load(applyInspector(document, [0], values, catalog))
    }
  })
  it('round-trips validators and parameterless actions through real nested editor repeaters', () => {
    const { values } = roundTrip(schema, [1])
    const updated = applyInspector(schema, [1], values, catalog)
    expect(updated.form[1]).toMatchObject({
      validators: schema.form[1].validators,
      rules: schema.form[1].rules,
      current_value: 'Ada',
    })
    load(updated)
  })
  it('round-trips typed action settings, including falsy values and empty error arrays', () => {
    const document: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        { type: 'text', key: 'source' },
        {
          type: 'boolean',
          key: 'target',
          rules: [
            {
              when: { property: 'source', operation: 'Eq', value: 'yes' },
              then: [
                { kind: 'set_value', value: false },
                { kind: 'set_hidden', hidden: false },
                { kind: 'set_errors', errors: [] },
              ],
            },
          ],
        },
      ],
    }
    const { values } = roundTrip(document, [1])
    const updated = applyInspector(document, [1], values, catalog)
    expect(updated.form[1].rules).toEqual(document.form[1].rules)
    load(updated)
  })

  it('retains zero, false and explicit null defaults and omits disabled defaults', () => {
    for (const [type, value] of [
      ['number', 0],
      ['boolean', false],
      ['text', null],
    ] as const) {
      const document: TungstenSchema = {
        schemaVersion: 'sprout',
        form: [{ type, key: 'value', current_value: value }],
      }
      const { values } = roundTrip(document, [0])
      const updated = applyInspector(document, [0], values, catalog)
      expect(updated.form[0].current_value).toBe(value)
      expect(JSON.parse(load(updated).get_values()).value).toBe(value)
      expect(
        applyInspector(document, [0], { ...values, hasDefault: false }, catalog).form[0],
      ).not.toHaveProperty('current_value')
    }
  })
  it('keeps identity through reorder and updates external references when a child is renamed', () => {
    const document: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'group',
          key: 'g',
          variant: 'basic',
          render: { type: 'group', settings: {} },
          subform: [
            { type: 'text', key: 'g.a', current_value: 'A' },
            { type: 'text', key: 'g.b', current_value: 'B' },
          ],
        },
        {
          type: 'text',
          key: 'outside',
          rules: [
            {
              when: { property: 'g.a', operation: 'Eq', value: { ref: 'g.b' } },
              then: [{ kind: 'show' }],
            },
          ],
        },
      ],
    }
    const { values } = roundTrip(document, [0])
    const items = values.components as RepeaterItem[]
    const updated = applyInspector(
      document,
      [0],
      { ...values, components: [{ ...items[1], key: 'g.c' }, items[0]] },
      catalog,
    )
    expect(childrenOf(updated.form[0]).map((field) => [field.key, field.current_value])).toEqual([
      ['g.c', 'B'],
      ['g.a', 'A'],
    ])
    expect(updated.form[1].rules).toMatchObject([
      { when: { property: 'g.a', value: { ref: 'g.c' } } },
    ])
    load(updated)
  })
  it('renames nested current and numeric references across the document', () => {
    const document: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'repeater',
          key: 'people',
          current_value: [{ children: [{ name: 'Ada' }] }],
          render: { type: 'tabs', settings: {} },
          template: [
            {
              type: 'repeater',
              key: 'people.children',
              render: { type: 'undereachother', settings: {} },
              template: [
                {
                  type: 'text',
                  key: 'people.children.name',
                  rules: [
                    {
                      when: {
                        property: 'people[current].children[current].name',
                        operation: 'Eq',
                        value: 'Ada',
                      },
                      then: [{ kind: 'show' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'boolean',
          key: 'found',
          rules: [
            {
              when: { property: 'people[0].children[0].name', operation: 'Eq', value: 'Ada' },
              then: [{ kind: 'set_value', value: true }],
            },
          ],
        },
      ],
    }
    const updated = renameSchema(document, 'people', 'families')
    expect(JSON.stringify(updated)).toContain('families[current].children[current].name')
    expect(JSON.stringify(updated)).toContain('families[0].children[0].name')
    expect(JSON.parse(load(updated).get_values()).found).toBe(true)
  })
  it('emits only the active renderer settings after a presentation switch', () => {
    const document: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'group',
          key: 'g',
          variant: 'basic',
          render: { type: 'row', settings: { gap: 12, wrap: true } },
          subform: [],
        },
      ],
    }
    const { values } = roundTrip(document, [0])
    const updated = applyInspector(document, [0], { ...values, 'render.type': 'fieldset' }, catalog)
    expect(updated.form[0]).toMatchObject({ render: { type: 'fieldset', settings: {} } })
    load(updated)
  })
  it('rejects malformed JSON, rules, validators and excessive structural depth before building an inspector', () => {
    expect(() => parseSchema('{', catalog.maxDepth)).toThrow()
    for (const extras of [
      { rules: [null] },
      { validators: [null] },
      { rules: [{ when: null, then: [] }] },
    ])
      expect(() =>
        parseSchema(
          JSON.stringify({
            schemaVersion: 'sprout',
            form: [{ type: 'text', key: 'a', ...extras }],
          }),
          catalog.maxDepth,
        ),
      ).toThrow()
    let components: TungstenComponent[] = []
    for (let i = 0; i <= catalog.maxDepth; i++)
      components = [
        {
          type: 'group',
          key: 'g',
          variant: 'basic',
          render: { type: 'group', settings: {} },
          subform: components,
        },
      ]
    expect(() =>
      parseSchema(JSON.stringify({ schemaVersion: 'sprout', form: components }), catalog.maxDepth),
    ).toThrow()
  })
})

it('renames source inputs while preserving registry keys and literal values', () => {
  const document: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      { type: 'text', key: 'input' },
      {
        type: 'text',
        key: 'output',
        bindings: {
          value: {
            source: 'names',
            params: { query: { ref: 'input' }, fixed: { value: 'input' } },
          },
        },
      },
    ],
  }
  const renamed = renameSchema(document, 'input', 'query')
  expect(renamed.form[1]).toMatchObject({
    bindings: {
      value: { source: 'names', params: { query: { ref: 'query' }, fixed: { value: 'input' } } },
    },
  })
  runtime().load_form_integrated(JSON.stringify(renamed), 'null', false, JSON.stringify(['names']))
})
it('round-trips a file default through the JSON settings inspector', () => {
  const document: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      {
        type: 'file',
        key: 'attachment',
        upload: { api: 'main', endpoint: 'files' },
        current_value: {
          files: [{ id: 'one', name: 'one.txt', size: 1, mediaType: 'text/plain', uploaded: true }],
        },
      },
    ],
  }
  const { values } = roundTrip(document, [0])
  const updated = applyInspector(document, [0], values, catalog)
  expect(updated.form[0]).toMatchObject(document.form[0])
  load(updated)
})
it('round-trips a multiple select array default through the JSON settings inspector', () => {
  const document: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      {
        type: 'select',
        key: 'cities',
        multiple: true,
        selectFirstOption: true,
        current_value: ['BA', 'KE'],
        options: [
          { value: 'BA', label: 'Bratislava' },
          { value: 'KE', label: 'Košice' },
        ],
      },
    ],
  }
  const { values } = roundTrip(document, [0])
  const updated = applyInspector(document, [0], values, catalog)
  expect(updated.form[0]).toMatchObject(document.form[0])
  load(updated)
})

it('round-trips text and boolean settings and removes incompatible settings on variant changes', () => {
  for (const component of [
    { type: 'text', key: 'notes', textarea: true, rows: 4, resizable: false },
    {
      type: 'boolean',
      key: 'answer',
      variant: 'radio',
      direction: 'row',
      options: [
        { value: false, label: 'No' },
        { value: true, label: 'Yes' },
      ],
    },
  ]) {
    const document: TungstenSchema = { schemaVersion: 'sprout', form: [component] }
    const { values } = roundTrip(document, [0])
    const updated = applyInspector(document, [0], values, catalog)
    expect(updated.form[0]).toMatchObject(component)
    load(updated)
    const change =
      component.type === 'text'
        ? { 'typeOptions.text.textarea': false, 'typeOptions.text.variant': 'password' }
        : { 'typeOptions.boolean.variant': 'switch' }
    const switched = applyInspector(document, [0], { ...values, ...change }, catalog)
    for (const setting of component.type === 'text'
      ? ['rows', 'resizable']
      : ['options', 'direction'])
      expect(switched.form[0]).not.toHaveProperty(setting)
    load(switched)
  }
})

it('authors disabled/read-only flags and retains them when changing field type', () => {
  const document: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [{ type: 'text', key: 'name', disabled: true, readOnly: true }],
  }
  const { values } = roundTrip(document, [0])
  expect(values).toMatchObject({ disabled: true, readOnly: true })
  const updated = applyInspector(document, [0], { ...values, type: 'number' }, catalog)
  expect(updated.form[0]).toMatchObject({ type: 'number', disabled: true, readOnly: true })
})
