import { fieldTypeOf, isGroup, isRepeater } from '../../../../api/src/types.js'
import type {
  AuthoringCatalog,
  FieldDescriptor,
  TungstenComponent,
  TungstenField,
  TungstenSchema,
  TungstenValues,
  RepeaterItem,
} from '../types.js'

export type ComponentPath = readonly number[]
export const emptySchema: TungstenSchema = { schemaVersion: 'sprout', form: [] }
export const childrenOf = (component: TungstenComponent): readonly TungstenComponent[] =>
  isGroup(component) ? component.subform : isRepeater(component) ? component.template : []
export function componentAt(
  schema: TungstenSchema,
  path: ComponentPath,
): TungstenComponent | undefined {
  let components = schema.form
  let component: TungstenComponent | undefined
  for (const index of path) {
    component = components[index]
    if (!component) return
    components = childrenOf(component)
  }
  return component
}
export function replaceAt(
  schema: TungstenSchema,
  path: ComponentPath,
  component: TungstenComponent | null,
): TungstenSchema {
  function update(components: readonly TungstenComponent[], depth: number): TungstenComponent[] {
    return components.flatMap((entry, index) => {
      if (index !== path[depth]) return [entry]
      if (depth === path.length - 1) return component ? [component] : []
      if (isGroup(entry)) return [{ ...entry, subform: update(entry.subform, depth + 1) }]
      if (isRepeater(entry)) return [{ ...entry, template: update(entry.template, depth + 1) }]
      return [entry]
    })
  }
  return { ...schema, form: update(schema.form, 0) }
}
function prefixPath(path: string, from: string, to: string): string {
  const parts = path.split('.')
  const old = from.split('.')
  if (parts.length < old.length || old.some((name, index) => parts[index].split('[')[0] !== name))
    return path
  const next = to.split('.')
  const selectors = parts.slice(0, old.length).map((part) => part.slice(part.split('[')[0].length))
  return [
    ...next.map(
      (part, index) =>
        `${part}${index === next.length - 1 ? (selectors.at(-1) ?? '') : (selectors[index] ?? '')}`,
    ),
    ...parts.slice(old.length),
  ].join('.')
}
/** Rename namespaces and references together, including numeric/current selectors. */
export function renameSchema(schema: TungstenSchema, from: string, to: string): TungstenSchema {
  return rewritePaths(schema, [[from, to]], true, true)
}
function rewritePaths(
  schema: TungstenSchema,
  renames: readonly (readonly [string, string])[],
  keys: boolean,
  references: boolean,
): TungstenSchema {
  const ordered = [...renames].sort((a, b) => b[0].length - a[0].length)
  const rename = (path: string) => {
    for (const [from, to] of ordered) {
      const next = prefixPath(path, from, to)
      if (next !== path) return next
    }
    return path
  }
  function walk(components: readonly TungstenComponent[]): TungstenComponent[] {
    return components.map((component) => {
      const key = keys ? rename(component.key) : component.key
      if (isGroup(component))
        return {
          ...component,
          key,
          render: {
            ...component.render,
            settings: {
              ...component.render.settings,
              ...(references && typeof component.render.settings.initialSection === 'string'
                ? { initialSection: rename(component.render.settings.initialSection) }
                : {}),
            },
          },
          subform: walk(component.subform),
        }
      if (isRepeater(component)) return { ...component, key, template: walk(component.template) }
      const rules = references
        ? component.rules?.map((unknownRule) => {
            const rule = unknownRule as {
              when: { property: string; value: unknown }
              then: unknown[]
            }
            const operand = rule.when.value as { ref?: string } | null
            return {
              ...rule,
              when: {
                ...rule.when,
                property: rename(rule.when.property),
                value:
                  operand && typeof operand === 'object' && typeof operand.ref === 'string'
                    ? { ...operand, ref: rename(operand.ref) }
                    : rule.when.value,
              },
            }
          })
        : component.rules
      const bindings =
        references && component.bindings
          ? Object.fromEntries(
              Object.entries(component.bindings).map(([slot, binding]) => [
                slot,
                {
                  ...binding,
                  ...(binding.params
                    ? {
                        params: Object.fromEntries(
                          Object.entries(binding.params).map(([name, input]) => [
                            name,
                            'ref' in input ? { ref: rename(input.ref) } : input,
                          ]),
                        ),
                      }
                    : {}),
                },
              ]),
            )
          : component.bindings
      return { ...component, key, ...(rules ? { rules } : {}), ...(bindings ? { bindings } : {}) }
    })
  }
  return { ...schema, form: walk(schema.form) }
}
export function parseSchema(json: string, maxDepth: number): TungstenSchema {
  const schema = JSON.parse(json) as TungstenSchema
  if (
    !schema ||
    typeof schema !== 'object' ||
    typeof schema.schemaVersion !== 'string' ||
    !Array.isArray(schema.form)
  )
    throw new Error(
      JSON.stringify({
        messageKey: 'tg_editor_use_a_schema_object_with_schemaversion_and_a_form_array',
        params: {},
      }),
    )
  function check(components: readonly TungstenComponent[], depth: number) {
    if (depth > maxDepth)
      throw new Error(
        JSON.stringify({
          messageKey: 'tg_editor_structural_nesting_is_limited_to_levels',
          params: { p0: maxDepth },
        }),
      )
    for (const entry of components) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.key !== 'string' ||
        typeof fieldTypeOf(entry) !== 'string'
      )
        throw new Error(
          JSON.stringify({
            messageKey: 'tg_editor_every_component_needs_a_type_and_string_key',
            params: {},
          }),
        )
      if (isGroup(entry) || isRepeater(entry)) {
        const children = isGroup(entry) ? entry.subform : entry.template
        if (!Array.isArray(children) || !entry.render || typeof entry.render.type !== 'string')
          throw new Error(
            JSON.stringify({
              messageKey: 'tg_editor_needs_children_and_a_render_descriptor',
              params: { p0: entry.key },
            }),
          )
        if (entry.render.settings === undefined) entry.render.settings = {}
        if (
          !entry.render.settings ||
          typeof entry.render.settings !== 'object' ||
          Array.isArray(entry.render.settings)
        )
          throw new Error(
            JSON.stringify({
              messageKey: 'tg_editor_needs_object_renderer_settings',
              params: { p0: entry.key },
            }),
          )
        check(children, depth + 1)
      } else {
        if (
          entry.rules !== undefined &&
          (!Array.isArray(entry.rules) ||
            entry.rules.some((raw) => {
              const rule = raw as {
                when?: { property?: unknown; operation?: unknown }
                then?: unknown
              }
              return (
                !rule ||
                typeof rule !== 'object' ||
                !rule.when ||
                typeof rule.when.property !== 'string' ||
                typeof rule.when.operation !== 'string' ||
                !Array.isArray(rule.then) ||
                rule.then.some(
                  (action) =>
                    !action ||
                    typeof action !== 'object' ||
                    typeof (action as { kind?: unknown }).kind !== 'string',
                )
              )
            }))
        )
          throw new Error(
            JSON.stringify({
              messageKey: 'tg_editor_has_malformed_rules',
              params: { p0: entry.key },
            }),
          )
        if (
          entry.validators !== undefined &&
          (!Array.isArray(entry.validators) ||
            entry.validators.some((validator) => !validator || typeof validator.kind !== 'string'))
        )
          throw new Error(
            JSON.stringify({
              messageKey: 'tg_editor_has_malformed_validators',
              params: { p0: entry.key },
            }),
          )
      }
    }
  }
  check(schema.form, 0)
  return schema
}
export function newComponent(
  type: string,
  key: string,
  catalog: AuthoringCatalog,
): TungstenComponent {
  if (type === 'group')
    return {
      type,
      key,
      variant: 'basic',
      view: { label: 'tg_editor_section' },
      render: {
        type:
          catalog.groupRenderers.find((r) => r.type === 'group')?.type ??
          catalog.groupRenderers.find((r) => r.variant === 'basic')!.type,
        settings: {},
      },
      subform: [],
    }
  if (type === 'repeater')
    return {
      type,
      key,
      view: { label: 'tg_editor_items' },
      render: { type: catalog.repeaterRenderers[0].type, settings: {} },
      template: [],
      reorder: true,
    }
  return {
    type,
    key,
    view: { label: catalog.fields.find((field) => field.type === type)?.label ?? type },
  }
}
const field = (key: string, label: string, extras: Partial<TungstenField> = {}): TungstenField => ({
  type: 'text',
  key,
  view: { label },
  ...extras,
})
const select = (
  key: string,
  label: string,
  options: readonly string[],
  initial?: string,
): TungstenField =>
  field(key, label, {
    view: { label, editorControl: 'select', options },
    current_value: initial ?? options[0],
    validators: [{ kind: 'required' }],
  })
const jsonField = (key: string, label: string, initial = 'null') =>
  field(key, label, { view: { label, editorControl: 'json' }, current_value: initial })
function mappedSettings(
  components: readonly TungstenComponent[],
  prefix: string,
  selector?: { property: string; value: string },
): TungstenComponent[] {
  return components.map((component) => {
    if (isGroup(component))
      return {
        ...component,
        key: `${prefix}.${component.key}`,
        subform: mappedSettings(component.subform, prefix, selector),
      }
    if (isRepeater(component))
      return {
        ...component,
        key: `${prefix}.${component.key}`,
        template: mappedSettings(component.template, prefix, selector),
      }
    return {
      ...component,
      key: `${prefix}.${component.key}`,
      validators: selector
        ? component.validators?.filter((validator) => validator.kind !== 'required')
        : component.validators,
      rules: selector
        ? [
            {
              when: { ...selector, operation: 'Eq' },
              then: [{ kind: 'set_hidden', hidden: false }],
            },
            {
              when: { ...selector, operation: 'Neq' },
              then: [{ kind: 'set_hidden', hidden: true }],
            },
          ]
        : component.rules,
    }
  })
}
function itemsEditor(
  components: readonly TungstenComponent[],
  catalog: AuthoringCatalog,
  parent?: TungstenComponent,
): { schema: TungstenComponent; values: RepeaterItem[] } {
  const options =
    isGroup(parent ?? { type: 'text', key: '' }) &&
    (parent as { variant?: string })?.variant === 'sectioned'
      ? ['group']
      : [...catalog.fields.map((f) => f.type), 'group', 'repeater']
  const label =
    parent && isRepeater(parent) ? 'tg_editor_template_components' : 'tg_editor_components'
  return {
    schema: {
      type: 'repeater',
      key: 'components',
      view: {
        label,
        description:
          'tg_editor_add_remove_or_reorder_here_select_a_component_in_the_outline_to_edit_its_details',
      },
      reorder: true,
      render: { type: 'undereachother', settings: {} },
      template: [
        select('components.type', 'tg_editor_component_type', options),
        { type: 'text', key: 'components.identity', hidden: true },
        field('components.key', 'tg_editor_component_key', { validators: [{ kind: 'required' }] }),
        field('components.label', 'tg_editor_component_label'),
      ],
    },
    values: components.map((c) => ({
      type: fieldTypeOf(c),
      key: c.key,
      identity: c.key,
      label: c.view?.label ?? '',
    })),
  }
}
export function inspector(
  component: TungstenComponent | undefined,
  schema: TungstenSchema,
  catalog: AuthoringCatalog,
): { schema: TungstenSchema; values: TungstenValues } {
  const values: TungstenValues = {}
  const form: TungstenComponent[] = []
  const list = itemsEditor(component ? childrenOf(component) : schema.form, catalog, component)
  if (!component)
    return {
      schema: { schemaVersion: catalog.schemaVersion, form: [list.schema] },
      values: { components: list.values },
    }
  values.key = component.key
  values['view.label'] = component.view?.label ?? null
  values['view.description'] = component.view?.description ?? null
  form.push(...catalog.commonSettings)
  if (isGroup(component) || isRepeater(component)) {
    const renderers = isGroup(component) ? catalog.groupRenderers : catalog.repeaterRenderers
    values['render.type'] = component.render.type
    form.push(
      select(
        'render.type',
        'tg_editor_presentation',
        renderers.map((renderer) => renderer.type),
      ),
    )
    for (const renderer of renderers) {
      const prefix = `renderOptions.${renderer.type}`
      if (renderer.settings === null)
        form.push(
          ...mappedSettings([jsonField('json', 'tg_editor_custom_settings_json', '{}')], prefix, {
            property: 'render.type',
            value: renderer.type,
          }),
        )
      else
        form.push(
          ...mappedSettings(renderer.settings, prefix, {
            property: 'render.type',
            value: renderer.type,
          }),
        )
      if (renderer.type === component.render.type) {
        if (renderer.settings === null)
          values[`${prefix}.json`] = JSON.stringify(component.render.settings)
        else
          for (const [key, value] of Object.entries(component.render.settings))
            values[`${prefix}.${key}`] = value as string | number | boolean | null
      }
    }
    if (isRepeater(component)) {
      form.push(...catalog.repeaterSettings)
      values.min = component.min ?? 0
      values.max = component.max ?? null
      values.reorder = component.reorder ?? false
      form.push(jsonField('collectionDefault', 'tg_editor_default_array_json', '[]'), {
        type: 'boolean',
        key: 'hasDefault',
        view: { label: 'tg_editor_use_a_default_array' },
        current_value: false,
      })
      values.collectionDefault = JSON.stringify(component.current_value ?? [])
      values.hasDefault = component.current_value !== undefined
    }
    form.push(list.schema)
    values.components = list.values
  } else {
    form.push(
      select(
        'type',
        'tg_editor_field_type',
        catalog.fields.map((f) => f.type),
        fieldTypeOf(component),
      ),
      field('view.placeholder', 'tg_editor_placeholder'),
      {
        type: 'boolean',
        key: 'hidden',
        view: { label: 'tg_editor_initially_hidden' },
        current_value: false,
      },
      {
        type: 'boolean',
        key: 'disabled',
        view: { label: 'tg_editor_disabled' },
        current_value: false,
      },
      {
        type: 'boolean',
        key: 'readOnly',
        view: { label: 'tg_editor_read_only' },
        current_value: false,
      },
      {
        type: 'boolean',
        key: 'hasDefault',
        view: { label: 'tg_editor_use_a_default_value' },
        current_value: false,
      },
      jsonField('defaultValue', 'tg_editor_default_value_json'),
    )
    values.type = fieldTypeOf(component)
    values['view.placeholder'] = component.view?.placeholder ?? null
    values.hidden = component.hidden ?? false
    values.disabled = component.disabled ?? false
    values.readOnly = component.readOnly ?? false
    values.hasDefault = Object.hasOwn(component, 'current_value')
    values.defaultValue = JSON.stringify(component.current_value ?? null)
    // The type selector exposes its settings/validators from every registered type.
    for (const definition of catalog.fields) {
      const prefix = `typeOptions.${definition.type}`
      form.push(
        ...mappedSettings(
          definition.settings ?? [jsonField('json', 'tg_editor_custom_field_settings_json', '{}')],
          prefix,
          { property: 'type', value: definition.type },
        ),
      )
      if (definition.type === fieldTypeOf(component)) {
        if (definition.settings === null) {
          const {
            key: _key,
            type: _type,
            field_type: _alias,
            view: _view,
            validators: _validators,
            rules: _rules,
            current_value: _default,
            hidden: _hidden,
            errors: _errors,
            ...config
          } = component
          void [_key, _type, _alias, _view, _validators, _rules, _default, _hidden, _errors]
          values[`${prefix}.json`] = JSON.stringify(config)
        } else
          for (const setting of definition.settings)
            if (!isGroup(setting) && !isRepeater(setting)) {
              const value = component[setting.key]
              values[`${prefix}.${setting.key}`] =
                setting.view?.editorControl === 'json' && value !== undefined
                  ? JSON.stringify(value)
                  : ((value as string | number | boolean | null) ?? null)
            }
      }
      for (const validator of definition.validators) {
        const key = `validation.${definition.type}.${validator.kind}`
        form.push(
          ...mappedSettings(
            [
              {
                type: 'boolean',
                key: 'enabled',
                view: { label: validator.label, description: validator.description },
                current_value: false,
              },
              ...validator.settings,
            ],
            key,
            { property: 'type', value: definition.type },
          ),
        )
        const existing =
          definition.type === fieldTypeOf(component)
            ? component.validators?.find((v) => v.kind === validator.kind)
            : undefined
        values[`${key}.enabled`] = definition.type === fieldTypeOf(component) && !!existing
        for (const setting of validator.settings)
          values[`${key}.${setting.key}`] =
            (existing?.[setting.key] as string | number | boolean | null) ?? null
      }
    }
    const operations = [...new Set(catalog.fields.flatMap((f) => f.operations))]
    const actionOptions = catalog.actions.map((a) => a.kind)
    const rules: TungstenComponent = {
      type: 'repeater',
      key: 'rules',
      view: {
        label: 'tg_editor_rules',
        description:
          'tg_editor_a_rule_reads_another_field_and_acts_on_this_field_use_explicit_indexes_or_current_insi',
      },
      reorder: true,
      render: { type: 'undereachother', settings: {} },
      template: [
        field('rules.property', 'tg_editor_source_field', { validators: [{ kind: 'required' }] }),
        select('rules.operation', 'tg_editor_comparison', operations, 'Eq'),
        select('rules.operandType', 'tg_editor_compare_with', ['literal', 'reference'], 'literal'),
        ...mappedSettings(
          [jsonField('value', 'tg_editor_comparison_value_json')],
          'rules.literal',
          { property: 'rules[current].operandType', value: 'literal' },
        ),
        ...mappedSettings([field('ref', 'tg_editor_reference_field')], 'rules.reference', {
          property: 'rules[current].operandType',
          value: 'reference',
        }),
        {
          type: 'repeater',
          key: 'rules.actions',
          view: { label: 'tg_editor_actions' },
          min: 1,
          reorder: true,
          current_value: [{ kind: actionOptions[0] }],
          render: { type: 'undereachother', settings: {} },
          template: [
            select('rules.actions.kind', 'tg_editor_action', actionOptions),
            ...catalog.actions.flatMap((action) =>
              mappedSettings(action.settings, `rules.actions.options.${action.kind}`, {
                property: 'rules[current].actions[current].kind',
                value: action.kind,
              }),
            ),
          ],
        },
      ],
    }
    form.push(rules)
    values.rules = (component.rules ?? []).map((raw) => {
      const rule = raw as {
        when: { property: string; operation: string; value: unknown }
        then: Record<string, unknown>[]
      }
      const value = rule.when.value as { ref?: string } | null
      return {
        property: rule.when.property,
        operation: rule.when.operation,
        operandType: value && typeof value === 'object' && 'ref' in value ? 'reference' : 'literal',
        literal: { value: JSON.stringify(rule.when.value) },
        reference: { ref: value && typeof value === 'object' ? (value.ref ?? null) : null },
        actions: rule.then.map((action) => ({
          kind: action.kind as string,
          ...(Object.keys(action).some((key) => key !== 'kind')
            ? {
                options: {
                  [action.kind as string]: Object.fromEntries(
                    Object.entries(action)
                      .filter(([key]) => key !== 'kind')
                      .map(([key, value]) => [
                        key,
                        key === 'value' || key === 'errors' ? JSON.stringify(value) : value,
                      ]),
                  ) as RepeaterItem,
                },
              }
            : {}),
        })),
      }
    })
  }
  return { schema: { schemaVersion: catalog.schemaVersion, form }, values }
}
function settingsValues(values: TungstenValues, prefix: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([key, value]) => key.startsWith(`${prefix}.`) && value !== null && value !== '')
      .map(([key, value]) => [key.slice(prefix.length + 1), value]),
  )
}
function parseJSON(value: unknown, label: string): unknown {
  try {
    return JSON.parse(String(value))
  } catch {
    throw new Error(
      JSON.stringify({
        messageKey: 'tg_editor_must_be_valid_json',
        params: { p0: { messageKey: label } },
      }),
    )
  }
}
function scalarJSON(value: unknown, label: string): unknown {
  const parsed = parseJSON(value, label)
  const object =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  const fileValue =
    object &&
    Object.keys(object).length === 1 &&
    Array.isArray(object.files) &&
    object.files.every((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
      const file = entry as Record<string, unknown>
      return (
        Object.keys(file).length === 5 &&
        typeof file.id === 'string' &&
        typeof file.name === 'string' &&
        typeof file.mediaType === 'string' &&
        typeof file.uploaded === 'boolean' &&
        typeof file.size === 'number' &&
        Number.isSafeInteger(file.size) &&
        file.size >= 0
      )
    })
  if (
    parsed !== null &&
    !['string', 'number', 'boolean'].includes(typeof parsed) &&
    !fileValue &&
    !(Array.isArray(parsed) && parsed.every((value: unknown) => typeof value === 'string'))
  )
    throw new Error(
      JSON.stringify({
        messageKey:
          'tg_editor_must_be_a_string_string_array_number_boolean_null_or_file_reference_object',
        params: { p0: { messageKey: label } },
      }),
    )
  return parsed
}
function listValues(
  values: TungstenValues,
  old: readonly TungstenComponent[],
  parent: TungstenComponent | undefined,
  catalog: AuthoringCatalog,
): TungstenComponent[] {
  const items = values.components as readonly RepeaterItem[]
  const used = new Set<string>()
  return items.map((item) => {
    const key = String(item.key ?? '')
    if (used.has(key))
      throw new Error(
        JSON.stringify({
          messageKey: 'tg_editor_component_key_is_duplicated',
          params: { p0: key },
        }),
      )
    used.add(key)
    const prior = old.find(
      (component) => component.key === item.identity && fieldTypeOf(component) === item.type,
    )
    let entry = prior
      ? rewritePaths(
          { schemaVersion: catalog.schemaVersion, form: [prior] },
          [[prior.key, key]],
          true,
          false,
        ).form[0]
      : old.find((component) => component.key === key && fieldTypeOf(component) === item.type)
    if (!entry) {
      const index = items.indexOf(item)
      const prior = old[index]
      entry =
        prior && fieldTypeOf(prior) === item.type && !items.some((next) => next.key === prior.key)
          ? rewritePaths(
              { schemaVersion: catalog.schemaVersion, form: [prior] },
              [[prior.key, key]],
              true,
              false,
            ).form[0]
          : newComponent(String(item.type), key, catalog)
    }
    if (
      parent &&
      isGroup(parent) &&
      parent.variant === 'sectioned' &&
      (!isGroup(entry) || entry.variant !== 'basic')
    )
      throw new Error(
        JSON.stringify({
          messageKey: 'tg_editor_sectioned_groups_need_basic_groups_as_their_direct_children',
          params: {},
        }),
      )
    return { ...entry, view: { ...entry.view, label: String(item.label ?? '') } }
  })
}
export function applyInspector(
  schema: TungstenSchema,
  path: ComponentPath,
  values: TungstenValues,
  catalog: AuthoringCatalog,
): TungstenSchema {
  const original = componentAt(schema, path)
  const oldChildren = original ? childrenOf(original) : schema.form
  const childRenames: [string, string][] = (
    (values.components ?? []) as readonly RepeaterItem[]
  ).flatMap((item) => {
    const prior = oldChildren.find(
      (entry) => entry.key === item.identity && fieldTypeOf(entry) === item.type,
    )
    return prior && prior.key !== item.key ? [[prior.key, String(item.key)]] : []
  })
  if (!original)
    return rewritePaths(
      { ...schema, form: listValues(values, schema.form, undefined, catalog) },
      childRenames,
      false,
      true,
    )
  const key = String(values.key ?? '')
  let result = schema
  const component = original
  let updated: TungstenComponent
  const view = {
    ...component.view,
    label: String(values['view.label'] ?? ''),
    description: String(values['view.description'] ?? ''),
  }
  if (isGroup(component) || isRepeater(component)) {
    const renderType = String(values['render.type'])
    const descriptor = (
      isGroup(component) ? catalog.groupRenderers : catalog.repeaterRenderers
    ).find((r) => r.type === renderType)!
    const settings =
      descriptor.settings === null
        ? (parseJSON(
            values[`renderOptions.${renderType}.json`],
            'tg_editor_renderer_settings',
          ) as Record<string, unknown>)
        : settingsValues(values, `renderOptions.${renderType}`)
    const render = { type: renderType, settings }
    const children = listValues(values, childrenOf(component), component, catalog)
    if (isGroup(component))
      updated = { ...component, key, view, variant: descriptor.variant!, render, subform: children }
    else {
      const { current_value: _default, max: _max, ...rest } = component
      void [_default, _max]
      updated = {
        ...rest,
        key,
        view,
        render,
        template: children,
        min: Number(values.min ?? 0),
        ...(values.max === null ? {} : { max: Number(values.max) }),
        reorder: !!values.reorder,
        ...(values.hasDefault
          ? {
              current_value: parseJSON(
                values.collectionDefault,
                'tg_editor_default_array',
              ) as RepeaterItem[],
            }
          : {}),
      }
    }
  } else {
    const type = String(values.type)
    const descriptor = catalog.fields.find((f) => f.type === type)!
    const settings =
      descriptor.settings === null
        ? (parseJSON(values[`typeOptions.${type}.json`], 'tg_editor_field_settings') as Record<
            string,
            unknown
          >)
        : settingsValues(values, `typeOptions.${type}`)
    for (const setting of descriptor.settings ?? []) {
      if (
        !isGroup(setting) &&
        !isRepeater(setting) &&
        setting.view?.editorControl === 'json' &&
        settings[setting.key] !== undefined
      ) {
        settings[setting.key] = parseJSON(settings[setting.key], setting.view.label)
      }
    }
    if (type === 'text' && settings.textarea !== true) {
      delete settings.rows
      delete settings.resizable
    }
    if (type === 'boolean' && settings.variant !== 'radio') {
      delete settings.options
      delete settings.direction
    }
    const validators = descriptor.validators
      .flatMap((validator) => {
        const prefix = `validation.${type}.${validator.kind}`
        return values[`${prefix}.enabled`]
          ? [{ kind: validator.kind, ...settingsValues(values, prefix), enabled: undefined }]
          : []
      })
      .map(({ enabled: _enabled, ...validator }) => {
        void _enabled
        return validator
      })
    if (type === fieldTypeOf(component))
      validators.push(
        ...(component.validators ?? []).filter(
          (validator) => !descriptor.validators.some((known) => known.kind === validator.kind),
        ),
      )
    const rules = (values.rules as readonly RepeaterItem[]).map((rule) => ({
      when: {
        property: rule.property,
        operation: rule.operation,
        value:
          rule.operandType === 'reference'
            ? { ref: (rule.reference as RepeaterItem).ref }
            : scalarJSON((rule.literal as RepeaterItem).value, 'tg_editor_comparison_value'),
      },
      then: (rule.actions as readonly RepeaterItem[]).map((action) => {
        const descriptor = catalog.actions.find((a) => a.kind === action.kind)!
        const options = ((action.options as RepeaterItem)?.[String(action.kind)] ??
          {}) as RepeaterItem
        return {
          kind: action.kind,
          ...Object.fromEntries(
            descriptor.settings.map((setting) => [
              setting.key,
              setting.key === 'value'
                ? scalarJSON(options[setting.key], 'tg_editor_action_value')
                : setting.key === 'errors'
                  ? parseJSON(options[setting.key], 'tg_editor_errors')
                  : options[setting.key],
            ]),
          ),
        }
      }),
    }))
    const { current_value: _default, field_type: _alias, ...rest } = component
    void [_default, _alias]
    for (const setting of descriptor.settings ?? []) delete rest[setting.key]
    // Switching types retains only common state; unrelated extension settings are discarded.
    const common =
      type === fieldTypeOf(component)
        ? rest
        : {
            key,
            view,
            hidden: component.hidden,
            disabled: component.disabled,
            readOnly: component.readOnly,
            errors: component.errors,
          }
    updated = {
      ...common,
      ...settings,
      key,
      type,
      view: { ...view, placeholder: String(values['view.placeholder'] ?? '') },
      hidden: !!values.hidden,
      disabled: !!values.disabled,
      readOnly: !!values.readOnly,
      validators,
      rules,
      ...(values.hasDefault
        ? {
            current_value: scalarJSON(
              values.defaultValue,
              'tg_editor_default_value',
            ) as TungstenField['current_value'],
          }
        : {}),
    }
  }
  result = rewritePaths(
    replaceAt(result, path, { ...updated, key: original.key }),
    childRenames,
    false,
    true,
  )
  return renameSchema(result, original.key, key)
}
export function fieldDescriptor(
  component: TungstenComponent,
  catalog: AuthoringCatalog,
): FieldDescriptor | undefined {
  return catalog.fields.find((field) => field.type === fieldTypeOf(component))
}
