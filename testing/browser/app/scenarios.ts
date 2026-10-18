import type { TungstenComponent, TungstenField, TungstenSchema } from '@myoon/tungsten/react'

const text = (key: string, extra: Partial<TungstenField> = {}): TungstenField => ({
  type: 'text',
  key,
  view: { label: key },
  ...extra,
})
const form = (...components: TungstenComponent[]): TungstenSchema => ({
  schemaVersion: 'sprout',
  form: components,
})
export function scenario(name: string, count = 10, mounted = 100, affected = 1): TungstenSchema {
  if (name === 'presentation-spacing')
    return form(
      {
        type: 'group',
        key: 'contact',
        variant: 'basic',
        view: {
          label: 'A longer contact section heading that must wrap on small screens',
          description: 'Group descriptions should stay separate from the fields below.',
        },
        render: { type: 'card', settings: {} },
        subform: [
          {
            type: 'group',
            key: 'contact.details',
            variant: 'basic',
            view: { label: 'Nested details with a longer fieldset legend' },
            render: { type: 'fieldset', settings: { gap: 0 } },
            subform: [
              text('contact.details.name', {
                view: {
                  label: 'A longer name label that should fit within its control',
                  placeholder: 'Your name',
                  description: 'An explanatory hint beneath the field.',
                },
                current_value: 'Ada',
              }),
              text('contact.details.notes', {
                textarea: true,
                rows: 3,
                view: {
                  label: 'Additional notes',
                  description: 'Text and hint stay apart even with a zero group gap.',
                },
              }),
            ],
          },
        ],
      },
      {
        type: 'repeater',
        key: 'people',
        reorder: true,
        view: { label: 'People with a longer heading and accessible add and reorder actions' },
        render: { type: 'undereachother', settings: {} },
        template: [text('people.name', { view: { label: 'Name' } })],
      },
    )
  if (name === 'theme-controls')
    return form(
      text('editable', { current_value: 'Editable' }),
      text('readonly', { current_value: 'Read only', readOnly: true }),
      text('disabled', { current_value: 'Disabled', disabled: true }),
      {
        type: 'select',
        key: 'choice',
        view: { label: 'Choice' },
        current_value: 'a',
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ],
      },
      {
        type: 'select',
        key: 'multiple',
        multiple: true,
        view: { label: 'Multiple' },
        current_value: ['a'],
        options: [{ value: 'a', label: 'Alpha' }],
      },
      {
        type: 'boolean',
        key: 'radio',
        variant: 'radio',
        current_value: true,
        view: { label: 'Radio' },
      },
      {
        type: 'boolean',
        key: 'switch',
        variant: 'switch',
        current_value: true,
        view: { label: 'Switch' },
      },
      {
        type: 'file',
        key: 'files',
        upload: { api: 'test', endpoint: 'files' },
        view: { label: 'Files' },
      },
    )
  if (name === 'date-locale')
    return form({
      type: 'date',
      key: 'day',
      current_value: '2026-10-10',
      view: { label: 'Day' },
      validators: [{ kind: 'required' }],
    })
  const readonlyFields: Record<string, Partial<TungstenField>> = {
    'readonly-radio': { type: 'boolean', variant: 'radio' },
    'readonly-select': { type: 'select' },
    'readonly-multiple': { type: 'select', multiple: true },
    'readonly-file': { type: 'file', upload: { api: 'main', endpoint: 'files' } },
  }
  if (readonlyFields[name])
    return form({
      ...readonlyFields[name],
      type: readonlyFields[name].type!,
      key: 'answer',
      readOnly: true,
      view: { label: 'Answer' },
      validators: [{ kind: 'required' }],
    })
  if (name === 'benchmark-practical') {
    const base = scenario('benchmark', count, count)
    return form(
      ...base.form.map((component, index) => {
        if (index < 2) return component
        const common = { key: component.key, view: { label: component.key } }
        switch (index % 10) {
          case 0:
            return text(component.key, { current_value: 'person@example.com', variant: 'email' })
          case 1:
            return text(component.key, { current_value: 'draft-secret', variant: 'password' })
          case 2:
            return text(component.key, { current_value: '+421900123456', variant: 'tel' })
          case 3:
            return text(component.key, {
              current_value: 'Application notes',
              textarea: true,
              rows: 3,
            })
          case 4:
            return { ...common, type: 'date', current_value: '2026-10-09' }
          case 5:
            return { ...common, type: 'date', mode: 'time', current_value: '09:30' }
          case 6:
            return {
              ...common,
              type: 'date',
              mode: 'datetime',
              timeZone: 'Europe/Bratislava',
              current_value: '2026-10-09T07:30:00Z',
            }
          case 7:
            return { ...common, type: 'boolean', variant: 'switch', current_value: false }
          default:
            return component
        }
      }),
    )
  }
  if (name === 'benchmark-line-items')
    return form({
      type: 'repeater',
      key: 'items',
      reorder: true,
      view: { label: 'Items' },
      render: { type: 'undereachother', settings: {} },
      template: [
        text('items.name', {
          current_value: 'New item',
          view: { label: 'Item' },
          validators: [{ kind: 'required' }],
        }),
        {
          type: 'number',
          key: 'items.quantity',
          current_value: 1,
          validators: [{ kind: 'min', value: 1 }],
        },
        {
          type: 'number',
          key: 'items.price',
          current_value: 10,
          validators: [{ kind: 'min', value: 0 }],
        },
        {
          type: 'select',
          key: 'items.category',
          current_value: 'goods',
          options: [
            { value: 'goods', label: 'Goods' },
            { value: 'service', label: 'Service' },
          ],
        },
      ],
    })
  if (name === 'benchmark-options')
    return form({
      type: 'select',
      key: 'choices',
      view: { label: 'Choices' },
      bindings: { options: { source: 'largeOptions' } },
    })
  if (name === 'benchmark-language')
    return form(
      ...scenario('benchmark', count, mounted).form.map((field) => ({
        ...field,
        view: { label: field.key },
      })),
    )
  if (name === 'benchmark-repeater')
    return form({
      type: 'repeater',
      key: 'people',
      reorder: true,
      view: { label: 'People' },
      render: { type: 'undereachother', settings: {} },
      template: [
        text('people.name', { view: { label: 'Name' }, validators: [{ kind: 'required' }] }),
        { type: 'boolean', key: 'people.active', current_value: false },
        {
          type: 'repeater',
          key: 'people.children',
          reorder: true,
          view: { label: 'Children' },
          render: { type: 'undereachother', settings: {} },
          template: [
            text('people.children.name', {
              current_value: 'child',
              validators: [{ kind: 'required' }],
            }),
            {
              type: 'number',
              key: 'people.children.amount',
              current_value: 1,
              validators: [{ kind: 'min', value: 0 }],
            },
            { type: 'boolean', key: 'people.children.active', current_value: false },
            {
              type: 'select',
              key: 'people.children.choice',
              current_value: 'a',
              options: [{ value: 'a', label: 'Alpha' }],
            },
          ],
        },
      ],
    })
  if (name === 'benchmark-chain' || name === 'benchmark-fanout') {
    const base = scenario('benchmark', count, mounted)
    const components = [...base.form]
    for (let index = 1; index <= affected; index++) {
      components[index] = text(`field_${index}`, {
        current_value: 'ready',
        hidden: index >= mounted,
        rules: ['odd', 'even'].map((value) => ({
          when: {
            property: `field_${name === 'benchmark-chain' ? index - 1 : 0}`,
            operation: 'Eq' as const,
            value,
          },
          then: [{ kind: 'set_value' as const, value }],
        })),
      })
    }
    return form(...components)
  }
  if (name === 'diagnostics')
    return {
      schemaVersion: 'sprout',
      form: [
        { type: 'text', key: 'source', view: { label: 'Source' } },
        {
          type: 'text',
          key: 'target',
          current_value: 'A',
          view: { label: 'Target' },
          rules: [
            {
              when: { property: 'source', operation: 'Eq', value: 'go' },
              then: [
                { kind: 'set_value', value: 'B' },
                { kind: 'set_value', value: 'C' },
              ],
            },
          ],
        },
      ],
    }
  if (name === 'invalid-schema')
    return { schemaVersion: 'sprout', form: [{ type: 'unregistered', key: 'missing' }] }

  if (name.startsWith('field-')) {
    const key = name.slice(6)
    return form(...scenario('fields').form.filter((field) => field.key === key))
  }
  if (name.startsWith('group-')) {
    const type = name.slice(6)
    return form({
      type: 'group',
      key: 'details',
      variant: 'basic',
      view: {
        label: 'Details',
        description:
          'Details about these fields should stay below the heading and clear of the close button.',
      },
      render: {
        type,
        settings: ['modal', 'drawer', 'sheet'].includes(type)
          ? { triggerLabel: 'Open details' }
          : {},
      },
      subform: [
        text('details.value', { view: { label: 'Value' }, validators: [{ kind: 'required' }] }),
      ],
    })
  }
  if (name.startsWith('section-')) {
    const schema = scenario('tabs')
    const group = schema.form[0] as import('@myoon/tungsten/react').TungstenGroup
    return form({ ...group, render: { type: name.slice(8), settings: {} } })
  }
  if (name === 'repeater-tabs') {
    const repeater = scenario('repeater')
      .form[0] as import('@myoon/tungsten/react').TungstenRepeater
    return form({ ...repeater, render: { type: 'tabs', settings: {} } })
  }
  if (name === 'nested-repeater') {
    return form({
      type: 'repeater',
      key: 'people',
      view: { label: 'People' },
      render: { type: 'undereachother', settings: {} },
      reorder: true,
      template: [
        text('people.name', { view: { label: 'Name' } }),
        {
          type: 'repeater',
          key: 'people.children',
          view: { label: 'Children' },
          render: { type: 'undereachother', settings: {} },
          reorder: true,
          template: [text('people.children.name', { view: { label: 'Child name' } })],
        },
      ],
    })
  }
  switch (name) {
    case 'async':
      return form(
        {
          type: 'select',
          key: 'country',
          view: { label: 'Country' },
          current_value: 'SK',
          options: [
            { value: 'SK', label: 'Slovakia' },
            { value: 'CZ', label: 'Czechia' },
          ],
        },
        {
          type: 'select',
          key: 'region',
          view: { label: 'Region' },
          bindings: { options: { source: 'regions', params: { country: { ref: 'country' } } } },
        },
        text('status', {
          rules: [
            {
              when: { property: 'region', operation: 'Eq', value: 'BA' },
              then: [{ kind: 'set_value', value: 'Region ready' }],
            },
            {
              when: { property: 'region', operation: 'Eq', value: null },
              then: [{ kind: 'set_value', value: 'Region cleared' }],
            },
          ],
        }),
      )
    case 'files':
    case 'files-selection':
      return form({
        type: 'file',
        key: 'attachment',
        view: { label: 'Attachment' },
        upload: {
          api: 'test',
          endpoint: 'files',
          timing: name === 'files' ? 'submit' : 'selection',
        },
        accept: ['text/plain'],
        maxSize: 1000,
        validators: [{ kind: 'required' }],
      })
    case 'select':
      return form({
        type: 'select',
        key: 'choices',
        view: { label: 'Choices' },
        multiple: true,
        options: [
          {
            value: 'a',
            label:
              'A very long option label that should wrap inside the input without making its remove button unreachable',
          },
          { value: 'b', label: 'Beta' },
          { value: 'c', label: 'Gamma' },
        ],
      })
    case 'fields':
      return form(
        text('plain', {
          view: { label: 'plain', placeholder: 'Your name' },
          validators: [{ kind: 'required' }, { kind: 'min_length', value: 2 }],
        }),
        text('email', { variant: 'email' }),
        text('password', { variant: 'password' }),
        text('tel', { variant: 'tel' }),
        text('notes', { textarea: true, rows: 3, resizable: false }),
        {
          type: 'number',
          key: 'quantity',
          view: { label: 'quantity' },
          validators: [{ kind: 'min', value: 0 }],
        },
        {
          type: 'boolean',
          key: 'checkbox',
          view: { label: 'checkbox' },
          validators: [{ kind: 'required' }],
        },
        { type: 'boolean', key: 'switch', variant: 'switch', view: { label: 'switch' } },
        {
          type: 'boolean',
          key: 'radio',
          variant: 'radio',
          view: { label: 'radio' },
          options: [
            { value: false, label: 'No' },
            { value: true, label: 'Yes' },
          ],
        },
        { type: 'date', key: 'day', view: { label: 'day' } },
        { type: 'date', key: 'time', mode: 'time', view: { label: 'time' } },
        {
          type: 'date',
          key: 'meeting',
          mode: 'datetime',
          timeZone: 'Europe/Bratislava',
          view: { label: 'meeting' },
        },
      )
    case 'tabs':
      return form({
        type: 'group',
        key: 'flow',
        variant: 'sectioned',
        view: { label: 'Flow' },
        render: { type: 'tabs', settings: {} },
        subform: [
          {
            type: 'group',
            key: 'flow.first',
            variant: 'basic',
            view: { label: 'First' },
            render: { type: 'group', settings: {} },
            subform: [text('flow.first.name', { current_value: 'Ada' })],
          },
          {
            type: 'group',
            key: 'flow.second',
            variant: 'basic',
            view: { label: 'Second' },
            render: { type: 'group', settings: {} },
            subform: [
              text('flow.second.email', { variant: 'email', validators: [{ kind: 'required' }] }),
            ],
          },
        ],
      })
    case 'repeater':
      return form({
        type: 'repeater',
        key: 'people',
        view: { label: 'People' },
        render: { type: 'undereachother', settings: {} },
        reorder: true,
        template: [text('people.name', { view: { label: 'Name' } })],
      })
    case 'hidden':
      return form(
        text('retained', { hidden: true, current_value: '', validators: [{ kind: 'required' }] }),
        text('visible', { current_value: 'Ready' }),
      )
    case 'benchmark':
      return form(
        ...Array.from({ length: count }, (_, index): TungstenField => {
          if (index === 0)
            return text('field_0', { current_value: 'ready', validators: [{ kind: 'required' }] })
          if (index === 1)
            return text('field_1', {
              current_value: 'ready',
              rules: [
                {
                  when: { property: 'field_0', operation: 'Eq', value: 'even' },
                  then: [{ kind: 'set_value', value: 'even' }],
                },
                {
                  when: { property: 'field_0', operation: 'Eq', value: 'odd' },
                  then: [{ kind: 'set_value', value: 'odd' }],
                },
              ],
            })
          const hidden = index >= mounted
          switch (index % 4) {
            case 0:
              return {
                type: 'number',
                key: `field_${index}`,
                hidden,
                current_value: 1,
                validators: [{ kind: 'min', value: 0 }],
              }
            case 1:
              return {
                type: 'boolean',
                key: `field_${index}`,
                hidden,
                current_value: false,
                validators: [{ kind: 'required' }],
              }
            case 2:
              return {
                type: 'select',
                key: `field_${index}`,
                hidden,
                current_value: 'a',
                options: [
                  { value: 'a', label: 'Alpha' },
                  { value: 'b', label: 'Beta' },
                ],
              }
            default:
              return text(`field_${index}`, {
                hidden,
                current_value: 'ready',
                validators: [{ kind: 'min_length', value: 2 }],
              })
          }
        }),
      )
    default:
      throw new Error(`Unknown scenario: ${name}`)
  }
}
