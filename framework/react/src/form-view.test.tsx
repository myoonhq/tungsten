import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { inputIds } from './input-ids.js'
import { FormView } from './FormView.js'
import { FormViewStore } from './view-store.js'
import { TungstenLanguageProvider } from './i18n.js'
import tungsten from '../../../design/tungsten/src/index.js'
import { fieldsOf } from '../../../api/src/types.js'
import type {
  FieldRendererProps,
  FormState,
  GroupRendererProps,
  RuntimeFieldState,
  TungstenDesign,
  TungstenSchema,
} from './types.js'

function initial(schema: TungstenSchema): FormState {
  return {
    fields: Object.fromEntries(
      fieldsOf(schema.form).map((field) => [
        field.key,
        { value: field.key, errors: [], hidden: false },
      ]),
    ),
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
function update(store: FormViewStore, changes: Record<string, Partial<RuntimeFieldState>>) {
  const fields = { ...store.state.fields }
  for (const [key, change] of Object.entries(changes)) fields[key] = { ...fields[key], ...change }
  const state = freeze({ ...store.state, fields })
  act(() => store.update(state, Object.keys(changes)))
  return state
}
function harness(schema: TungstenSchema, state = initial(schema), design = tungsten) {
  const store = new FormViewStore()
  store.update(freeze(state))
  const props = {
    schema,
    repeaters: state.repeaters,
    store,
    design,
    instanceId: 'test',
    busy: false,
    reveal: null,
    onChange: vi.fn(),
    onStructure: vi.fn(),
    onFiles: vi.fn(),
    onRetry: vi.fn(),
  }
  return { store, props }
}

describe('incremental React visuals / immutable snapshots', () => {
  it('updates two affected controls across rapid edits without rendering other controls or losing focus', () => {
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: Array.from({ length: 100 }, (_, index) => ({ type: 'text', key: `f${index}` })),
    }
    const rendered: Record<string, number> = {}
    const Text = tungsten.fields.text
    const design: TungstenDesign = {
      ...tungsten,
      fields: {
        ...tungsten.fields,
        text: (props: FieldRendererProps) => {
          rendered[props.field.key] = (rendered[props.field.key] ?? 0) + 1
          return <Text {...props} />
        },
      },
    }
    const { store, props } = harness(schema, undefined, design)
    render(<FormView {...props} />)
    const previous = store.state
    const unrelated = screen.getByLabelText('f99')
    const active = screen.getByLabelText('f0')
    const derived = screen.getByLabelText('f1')
    active.focus()
    for (let index = 0; index < 25; index++) {
      update(store, { f0: { value: `value-${index}` }, f1: { value: `derived-${index}` } })
      expect(active).toHaveValue(`value-${index}`)
      expect(derived).toHaveValue(`derived-${index}`)
    }
    expect(active).toHaveFocus()
    expect(screen.getByLabelText('f99')).toBe(unrelated)
    expect(rendered.f99).toBe(1)
    expect(rendered.f0).toBe(26)
    expect(rendered.f1).toBe(26)
    expect(previous.fields.f0.value).toBe('f0')
    expect(store.state.fields.f99).toBe(previous.fields.f99)
  })

  it('refreshes errors, visibility, disabled/readonly states and password masks while preserving hidden values', () => {
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        { type: 'text', key: 'secret', variant: 'password' },
        { type: 'text', key: 'other' },
      ],
    }
    const { store, props } = harness(schema)
    render(<FormView {...props} />)
    const other = screen.getByLabelText('other')
    update(store, { secret: { value: 'loaded secret', errors: ['Too short'], readOnly: true } })
    expect(screen.getByLabelText('secret')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('secret')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('secret')).toHaveValue('loaded secret')
    expect(screen.getByText('Too short')).toBeVisible()
    update(store, { secret: { disabled: true, errors: [], readOnly: false } })
    expect(screen.getByLabelText('secret')).toBeDisabled()
    expect(screen.queryByText('Too short')).not.toBeInTheDocument()
    update(store, { secret: { hidden: true } })
    expect(screen.queryByLabelText('secret')).not.toBeInTheDocument()
    expect(store.state.fields.secret.value).toBe('loaded secret')
    update(store, { secret: { hidden: false, disabled: false } })
    expect(screen.getByLabelText('secret')).toBeEnabled()
    expect(screen.getByLabelText('secret')).toHaveValue('loaded secret')
    expect(screen.getByLabelText('secret')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('other')).toBe(other)
  })

  it('shows async loading/failure/recovery and reads the latest source options', () => {
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [{ type: 'select', key: 'region' }],
    }
    const { store, props } = harness(schema, {
      fields: {
        region: {
          value: null,
          hidden: false,
          errors: [],
          unresolved: true,
          loadingSources: ['first'],
        },
      },
    })
    render(<FormView {...props} />)
    expect(screen.getByRole('combobox')).toBeDisabled()
    update(store, { region: { loadingSources: [], sourceErrors: { first: 'Connection failed' } } })
    expect(screen.getByText('Connection failed')).toBeVisible()
    update(store, { region: { sourceErrors: { second: 'Try again' } } })
    expect(screen.queryByText('Connection failed')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    expect(props.onRetry).toHaveBeenCalledWith(schema.form[0], false)
    update(store, { region: { loadingSources: ['second'], sourceErrors: {} } })
    expect(screen.getByRole('combobox')).toBeDisabled()
    update(store, {
      region: {
        loadingSources: [],
        unresolved: false,
        options: [{ value: 'BA', label: 'Bratislava' }],
        value: 'BA',
      },
    })
    expect(screen.getByRole('combobox')).toBeEnabled()
    expect(screen.getByRole('combobox')).toHaveTextContent('Bratislava')
    expect(screen.queryByText('Try again')).not.toBeInTheDocument()
  })

  it('updates ancestor and section error summaries atomically, including errors in inactive sections', () => {
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'group',
          key: 'flow',
          variant: 'sectioned',
          render: { type: 'sections', settings: {} },
          subform: ['one', 'two'].map((key) => ({
            type: 'group' as const,
            key,
            variant: 'basic' as const,
            render: { type: 'basic', settings: {} },
            subform: [{ type: 'text', key: `${key}.value` }],
          })),
        },
      ],
    }
    const Group = ({ group, errorCount, sections, children }: GroupRendererProps) => (
      <div>
        <output data-testid={group.key}>{errorCount}</output>
        {sections.map((section) => (
          <div key={section.group.key}>
            <output data-testid={`${group.key}-${section.group.key}`}>{section.errorCount}</output>
            {section.content}
          </div>
        ))}
        {children}
      </div>
    )
    const design: TungstenDesign = {
      ...tungsten,
      groups: {
        basic: { variant: 'basic', Renderer: Group },
        sections: { variant: 'sectioned', Renderer: Group },
      },
    }
    const { store, props } = harness(schema, undefined, design)
    const view = render(
      <StrictMode>
        <FormView {...props} />
      </StrictMode>,
    )
    update(store, {
      'one.value': { errors: ['First'] },
      'two.value': { errors: ['Second', 'Third'] },
    })
    expect(screen.getByTestId('flow')).toHaveTextContent('3')
    expect(screen.getByTestId('flow-one')).toHaveTextContent('1')
    expect(screen.getByTestId('flow-two')).toHaveTextContent('2')
    expect(screen.getByTestId('two')).toHaveTextContent('2')
    update(store, { 'one.value': { errors: [] }, 'two.value': { errors: ['Remaining'] } })
    expect(screen.getByTestId('flow')).toHaveTextContent('1')
    expect(screen.getByTestId('flow-one')).toHaveTextContent('0')
    expect(screen.getByTestId('flow-two')).toHaveTextContent('1')
    expect(screen.queryByText('Second')).not.toBeInTheDocument()
    expect(store.errors.get('one.value')?.size).toBe(2)
    view.unmount()
    expect(store.fields.size).toBe(0)
    expect(store.errors.size).toBe(0)
  })

  it('inherits language changes, refreshes replaced full snapshots and cleans subscriptions in Strict Mode', async () => {
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [{ type: 'text', key: 'name', view: { label: 'name.label' } }],
    }
    const { store, props } = harness(schema)
    const config = { translations: { en: { 'name.label': 'Name' }, sk: { 'name.label': 'Meno' } } }
    const view = render(
      <StrictMode>
        <TungstenLanguageProvider language="en" config={config}>
          <FormView {...props} />
        </TungstenLanguageProvider>
      </StrictMode>,
    )
    expect(await screen.findByLabelText('Name')).toHaveValue('name')
    view.rerender(
      <StrictMode>
        <TungstenLanguageProvider language="sk" config={config}>
          <FormView {...props} />
        </TungstenLanguageProvider>
      </StrictMode>,
    )
    expect(await screen.findByLabelText('Meno')).toHaveValue('name')
    act(() =>
      store.update(freeze({ fields: { name: { value: 'Restored', hidden: false, errors: [] } } })),
    )
    await waitFor(() => expect(screen.getByLabelText('Meno')).toHaveValue('Restored'))
    expect(store.fields.get('name')?.size).toBe(1)
    view.unmount()
    expect(store.fields.size).toBe(0)
    expect(store.errors.size).toBe(0)
  })
})

it('keeps the old repeater layout coherent when a delta arrives before a reordered layout commits', () => {
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      {
        type: 'repeater',
        key: 'people',
        render: { type: 'undereachother', settings: {} },
        template: [{ type: 'text', key: 'people.name' }],
      },
    ],
  }
  const collection = (ids: string[]) => ({
    length: 2,
    min: 0,
    canAdd: true,
    canRemove: true,
    canReorder: true,
    errors: [],
    instances: ids.map((id, index) => ({
      id,
      label: id,
      form: [{ type: 'text', key: `people[${index}].name`, view: { label: id } }],
    })),
  })
  const first: FormState = {
    repeaters: { people: collection(['A', 'B']) },
    fields: {
      'people[0].name': { value: 'Alice', hidden: false, errors: [] },
      'people[1].name': { value: 'Bob', hidden: false, errors: [] },
    },
  }
  const { store, props } = harness(schema, first)
  const view = render(<FormView {...props} />)
  const alice = screen.getByRole('textbox', { name: 'A', exact: true })
  const bob = screen.getByRole('textbox', { name: 'B', exact: true })
  const next: FormState = {
    repeaters: { people: collection(['B', 'A']) },
    fields: {
      'people[0].name': { value: 'Bob', hidden: false, errors: [] },
      'people[1].name': { value: 'Alice', hidden: false, errors: [] },
    },
  }
  act(() => store.update(freeze(next)))
  update(store, { 'people[0].name': { value: 'Robert', errors: ['Updated row'] } })
  expect(alice).toHaveValue('Alice')
  expect(bob).toHaveValue('Bob')
  expect(screen.queryByText('Updated row')).not.toBeInTheDocument()
  view.rerender(<FormView {...props} repeaters={next.repeaters} />)
  expect(screen.getByRole('textbox', { name: 'A', exact: true })).toBe(alice)
  expect(screen.getByRole('textbox', { name: 'B', exact: true })).toBe(bob)
  expect(alice).toHaveValue('Alice')
  expect(bob).toHaveValue('Robert')
  expect(screen.getByText('Updated row')).toBeVisible()
  view.unmount()
  expect(store.fields.size).toBe(0)
  expect(store.errors.size).toBe(0)
})

it('updates form readiness and content revisions independently of validation/presentation changes', () => {
  const schema: TungstenSchema = { schemaVersion: 'sprout', form: [{ type: 'text', key: 'name' }] }
  const { store } = harness(schema)
  const revision = store.contentRevision
  expect(store.valid).toBe(true)
  update(store, { name: { errors: ['Required'] } })
  expect(store.valid).toBe(false)
  expect(store.contentRevision).toBe(revision)
  update(store, { name: { hidden: true } })
  expect(store.valid).toBe(true)
  update(store, { name: { hidden: false, disabled: true } })
  expect(store.valid).toBe(true)
  update(store, { name: { disabled: false, readOnly: true } })
  expect(store.valid).toBe(false)
  update(store, { name: { value: 'Changed', errors: [], loadingSources: ['lookup'] } })
  expect(store.contentRevision).toBe(revision + 1)
  expect(store.valid).toBe(false)
  update(store, { name: { loadingSources: [], sourceErrors: { lookup: 'Offline' } } })
  expect(store.valid).toBe(false)
  update(store, { name: { sourceErrors: {}, uploading: true } })
  expect(store.valid).toBe(false)
  update(store, { name: { uploading: false } })
  expect(store.valid).toBe(true)
  expect(store.contentRevision).toBe(revision + 1)
})

it('keeps DOM ids stable when a different repeater row inserts fields or rows reorder', () => {
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      {
        type: 'repeater',
        key: 'people',
        render: { type: 'undereachother', settings: {} },
        template: [],
      },
    ],
  }
  type Row = NonNullable<FormState['repeaters']>[string]['instances'][number]
  const row = (id: string, index: number): Row => ({
    id,
    label: id,
    form: [{ key: `people[${index}].name`, type: 'text' }],
  })
  const state = (rows: Row[]): FormState => ({
    fields: {},
    repeaters: {
      people: {
        instances: rows,
        length: rows.length,
        errors: [],
        min: 0,
        canAdd: true,
        canRemove: true,
        canReorder: true,
      },
    },
  })
  const before = inputIds(schema, state([row('a', 0), row('b', 1)]), 'test')
  const after = inputIds(schema, state([row('c', 0), row('a', 1), row('b', 2)]), 'test')
  expect(after.get('people[1].name')).toBe(before.get('people[0].name'))
  expect(after.get('people[2].name')).toBe(before.get('people[1].name'))
  expect(new Set(after.values()).size).toBe(3)
})
