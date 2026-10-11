import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tungsten } from './Tungsten'
import type { FormState, TungstenRepeater, TungstenSchema } from './types'

const engine = vi.hoisted(() => ({
  load: vi.fn(),
  patch: vi.fn(),
  structure: vi.fn(),
  validate: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('../../../api/src/engine/client', () => ({
  EngineClient: class {
    load = engine.load
    patch = engine.patch
    structure = engine.structure
    validate = engine.validate
    destroy = engine.destroy
  },
}))
const repeater: TungstenRepeater = {
  type: 'repeater',
  key: 'person',
  view: { label: 'People' },
  reorder: true,
  template: [{ type: 'text', key: 'person.name', view: { label: 'Name' } }],
  render: { type: 'undereachother', settings: {} },
}
const schema: TungstenSchema = { schemaVersion: 'sprout', form: [repeater] }
function state(items: { id: string; name: string; error?: string }[]): FormState {
  return {
    fields: Object.fromEntries(
      items.map((item, index) => [
        `person[${index}].name`,
        { value: item.name, hidden: false, errors: item.error ? [item.error] : [] },
      ]),
    ),
    repeaters: {
      person: {
        length: items.length,
        min: 0,
        max: 3,
        canAdd: items.length < 3,
        canRemove: items.length > 0,
        canReorder: items.length > 1,
        errors: [],
        instances: items.map((item, index) => ({
          id: item.id,
          label: `#${index + 1} Person`,
          form: [{ type: 'text', key: `person[${index}].name`, view: { label: 'Name' } }],
        })),
      },
    },
  }
}
describe('repeaters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    engine.load.mockImplementation(async (schema) => ({ schema, state: state([]) }))
  })
  it('renders an empty collection and routes add/remove through structural commands', async () => {
    engine.structure
      .mockResolvedValueOnce({ state: state([{ id: '0', name: '' }]) })
      .mockResolvedValueOnce({ state: state([]) })
    render(<Tungsten schema={schema} onSubmit={vi.fn()} />)
    const add = await screen.findByRole('button', { name: 'Add to People' })
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    fireEvent.click(add)
    expect(await screen.findByLabelText('Name')).toHaveValue('')
    expect(engine.structure).toHaveBeenCalledWith({ kind: 'add', key: 'person' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove #1 Person' }))
    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument())
    expect(engine.structure).toHaveBeenLastCalledWith({ kind: 'remove', key: 'person', index: 0 })
  })
  it('keeps surviving DOM and instance values during reorder', async () => {
    const a = { id: 'a', name: 'Ada' }
    const b = { id: 'b', name: 'Grace' }
    engine.load.mockImplementation(async (schema) => ({ schema, state: state([a, b]) }))
    engine.structure.mockResolvedValue({ state: state([b, a]) })
    render(<Tungsten schema={schema} onSubmit={vi.fn()} />)
    const input = (await screen.findAllByLabelText('Name'))[0]
    fireEvent.click(screen.getByRole('button', { name: 'Move #1 Person later' }))
    await waitFor(() => expect(screen.getAllByLabelText('Name')[1]).toBe(input))
    expect(input).toHaveValue('Ada')
    expect(engine.structure).toHaveBeenCalledWith({
      kind: 'reorder',
      key: 'person',
      from: 0,
      to: 1,
    })
  })
  it('locks edits and submit until structure settles, then submits captured arrays', async () => {
    let complete!: (value: unknown) => void
    engine.structure.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    engine.validate.mockResolvedValue({
      state: state([{ id: 'a', name: 'Captured' }]),
      valid: true,
      values: { person: [{ name: 'Captured' }] },
    })
    const onSubmit = vi.fn()
    render(<Tungsten schema={schema} onSubmit={onSubmit} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to People' }))
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: 'Updating…' }).closest('form')!)
    expect(engine.validate).not.toHaveBeenCalled()
    complete({ state: state([{ id: 'a', name: 'Existing' }]) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ person: [{ name: 'Captured' }] }))
  })
  it('reveals and focuses an invalid inactive instance while retaining manual tab navigation', async () => {
    const tabs = { ...schema, form: [{ ...repeater, render: { type: 'tabs', settings: {} } }] }
    const initial = state([
      { id: 'a', name: 'Ada' },
      { id: 'b', name: 'Grace' },
    ])
    const invalid = state([
      { id: 'a', name: 'Ada' },
      { id: 'b', name: '', error: 'Name required' },
    ])
    engine.load.mockImplementation(async (schema) => ({ schema, state: initial }))
    engine.validate.mockResolvedValue({ state: invalid, valid: false })
    render(<Tungsten schema={tabs} onSubmit={vi.fn()} />)
    await screen.findByRole('tab', { name: '#1 Person' })
    expect(screen.getAllByRole('tabpanel', { hidden: true })[1]).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /#2 Person/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.getAllByLabelText('Name')[1]).toHaveFocus()
    fireEvent.click(screen.getByRole('tab', { name: '#1 Person' }))
    expect(screen.getByRole('tab', { name: '#1 Person' })).toHaveAttribute('aria-selected', 'true')
  })
  it('adding to tabs selects and focuses the new instance', async () => {
    const tabs = { ...schema, form: [{ ...repeater, render: { type: 'tabs', settings: {} } }] }
    engine.load.mockImplementation(async (schema) => ({
      schema,
      state: state([{ id: 'a', name: 'Ada' }]),
    }))
    engine.structure.mockResolvedValue({
      state: state([
        { id: 'a', name: 'Ada' },
        { id: 'b', name: '' },
      ]),
    })
    render(<Tungsten schema={tabs} onSubmit={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to People' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '#2 Person' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.getAllByLabelText('Name')[1]).toHaveFocus()
  })
  it('ignores a pending structural response after replacement data loads', async () => {
    let complete!: (value: unknown) => void
    engine.structure.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const view = render(
      <Tungsten schema={schema} initialValues={{ person: [] }} onSubmit={vi.fn()} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Add to People' }))
    engine.load.mockImplementation(async (schema) => ({
      schema,
      state: state([{ id: 'replacement', name: 'New data' }]),
    }))
    view.rerender(
      <Tungsten
        schema={schema}
        initialValues={{ person: [{ name: 'New data' }] }}
        onSubmit={vi.fn()}
      />,
    )
    expect(await screen.findByLabelText('Name')).toHaveValue('New data')
    complete({ state: state([{ id: 'old', name: 'Obsolete' }]) })
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('New data'))
  })
  it('uses core operation availability and displays cardinality errors', async () => {
    const snapshot = state([{ id: 'a', name: 'Ada' }])
    snapshot.repeaters!.person.canAdd = false
    snapshot.repeaters!.person.canRemove = false
    snapshot.repeaters!.person.errors = ['At least 2 instances are required.']
    engine.load.mockImplementation(async (schema) => ({ schema, state: snapshot }))
    render(<Tungsten schema={schema} onSubmit={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Add to People' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove #1 Person' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('At least 2 instances are required.')
  })
  it('rejects missing template renderers even for empty collections and reports failed controls', async () => {
    const bad = {
      ...schema,
      form: [{ ...repeater, template: [{ type: 'missing', key: 'person.name' }] }],
    }
    const view = render(<Tungsten schema={bad} onSubmit={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "no renderer for field type 'missing'",
    )
    view.rerender(<Tungsten schema={schema} onSubmit={vi.fn()} />)
    engine.structure.mockRejectedValue(new Error('Removal would break a rule reference.'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add to People' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Removal would break a rule reference.'),
    )
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })
})

const childRepeater: TungstenRepeater = {
  type: 'repeater',
  key: 'people.children',
  view: { label: 'Children' },
  reorder: true,
  template: [{ type: 'text', key: 'people.children.name', view: { label: 'Child name' } }],
  render: { type: 'tabs', settings: {} },
}
const nestedSchema: TungstenSchema = {
  schemaVersion: 'sprout',
  form: [
    {
      type: 'repeater',
      key: 'people',
      view: { label: 'People' },
      reorder: true,
      render: { type: 'tabs', settings: {} },
      template: [
        { type: 'text', key: 'people.name', view: { label: 'Parent name' } },
        childRepeater,
      ],
    },
  ],
}
type Parent = { id: string; name: string; children: { id: string; name: string; error?: string }[] }
function nestedState(parents: Parent[]): FormState {
  const result: FormState = { fields: {}, repeaters: {} }
  const availability = { min: 0, canAdd: true, canRemove: true, canReorder: true, errors: [] }
  result.repeaters!.people = {
    ...availability,
    length: parents.length,
    instances: parents.map((parent, index) => {
      const prefix = `people[${index}]`
      result.fields[`${prefix}.name`] = { value: parent.name, hidden: false, errors: [] }
      const key = `${prefix}.children`
      result.repeaters![key] = {
        ...availability,
        length: parent.children.length,
        instances: parent.children.map((child, childIndex) => {
          const path = `${key}[${childIndex}].name`
          result.fields[path] = {
            value: child.name,
            hidden: false,
            errors: child.error ? [child.error] : [],
          }
          return {
            id: child.id,
            label: `#${childIndex + 1} Child`,
            form: [{ type: 'text', key: path, view: { label: 'Child name' } }],
          }
        }),
      }
      return {
        id: parent.id,
        label: `#${index + 1} Parent`,
        form: [
          { type: 'text', key: `${prefix}.name`, view: { label: 'Parent name' } },
          { ...childRepeater, key },
        ],
      }
    }),
  }
  return result
}
describe('nested repeaters', () => {
  beforeEach(() => vi.clearAllMocks())
  const a: Parent = {
    id: 'a',
    name: 'Parent A',
    children: [
      { id: 'a0', name: 'Ada' },
      { id: 'a1', name: 'Grace' },
    ],
  }
  const b: Parent = { id: 'b', name: 'Parent B', children: [] }
  it('preserves nested DOM and active child tabs when a parent moves', async () => {
    engine.load.mockImplementation(async (schema) => ({ schema, state: nestedState([a, b]) }))
    engine.structure.mockResolvedValue({ state: nestedState([b, a]) })
    render(<Tungsten schema={nestedSchema} onSubmit={vi.fn()} />)
    await screen.findByDisplayValue('Ada')
    fireEvent.click(screen.getByRole('tab', { name: '#2 Child' }))
    const input = screen.getByDisplayValue('Grace')
    expect(input).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Move #1 Parent later' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: '#2 Parent' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.getByDisplayValue('Grace')).toBe(input)
    expect(input).toBeVisible()
    expect(screen.getByRole('tab', { name: '#2 Child' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Children' }))
    expect(engine.structure).toHaveBeenLastCalledWith({ kind: 'add', key: 'people[1].children' })
  })
  it('submits nested arrays from the captured state fallback', async () => {
    const snapshot = nestedState([a, b])
    engine.load.mockImplementation(async (schema) => ({ schema, state: snapshot }))
    engine.validate.mockResolvedValue({ state: snapshot, valid: true })
    const onSubmit = vi.fn()
    render(<Tungsten schema={nestedSchema} onSubmit={onSubmit} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        people: [
          { name: 'Parent A', children: [{ name: 'Ada' }, { name: 'Grace' }] },
          { name: 'Parent B', children: [] },
        ],
      }),
    )
  })
  it('reveals every inactive ancestor of an invalid nested child and focuses it', async () => {
    const second: Parent = {
      ...b,
      children: [
        { id: 'b0', name: 'Lin' },
        { id: 'b1', name: '', error: 'Required' },
      ],
    }
    const snapshot = nestedState([a, second])
    engine.load.mockImplementation(async (schema) => ({ schema, state: snapshot }))
    engine.validate.mockResolvedValue({ state: snapshot, valid: false })
    render(<Tungsten schema={nestedSchema} onSubmit={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /#2 Parent/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    const parentPanel = screen.getByRole('tabpanel', { name: /#2 Parent/ })
    expect(within(parentPanel).getByRole('tab', { name: /#2 Child/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const input = screen
      .getAllByLabelText('Child name')
      .find((input) => input.getAttribute('value') === '')!
    expect(input).toBeVisible()
    await waitFor(() => expect(input).toHaveFocus())
  })
})

it('keeps sectioned group navigation and controls inside a moved nested child', async () => {
  const parents: Parent[] = [
    {
      id: 'parent',
      name: 'P',
      children: [
        { id: 'child0', name: 'Ada' },
        { id: 'child1', name: 'Grace' },
      ],
    },
  ]
  function withSections(parents: Parent[]): FormState {
    const snapshot = nestedState(parents)
    const children = snapshot.repeaters!['people[0].children'].instances
    for (const [index, child] of children.entries()) {
      const prefix = `people[0].children[${index}].sections`
      delete snapshot.fields[`people[0].children[${index}].name`]
      snapshot.fields[`${prefix}.main.name`] = {
        value: parents[0].children[index].name,
        hidden: false,
        errors: [],
      }
      snapshot.fields[`${prefix}.extra.note`] = { value: 'Note', hidden: false, errors: [] }
      child.form = [
        {
          type: 'group',
          key: prefix,
          variant: 'sectioned',
          view: { label: 'Child sections' },
          render: { type: 'tabs', settings: {} },
          subform: [
            {
              type: 'group',
              key: `${prefix}.main`,
              variant: 'basic',
              view: { label: 'Main' },
              render: { type: 'group', settings: {} },
              subform: [
                { type: 'text', key: `${prefix}.main.name`, view: { label: 'Child name' } },
              ],
            },
            {
              type: 'group',
              key: `${prefix}.extra`,
              variant: 'basic',
              view: { label: 'Extra' },
              render: { type: 'group', settings: {} },
              subform: [{ type: 'text', key: `${prefix}.extra.note`, view: { label: 'Note' } }],
            },
          ],
        },
      ]
    }
    return snapshot
  }
  engine.load.mockImplementation(async (schema) => ({ schema, state: withSections(parents) }))
  engine.structure.mockResolvedValue({
    state: withSections([{ ...parents[0], children: [...parents[0].children].reverse() }]),
  })
  render(<Tungsten schema={nestedSchema} onSubmit={vi.fn()} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Extra' }))
  const note = screen.getAllByLabelText('Note')[0]
  note.focus()
  fireEvent.click(screen.getByRole('button', { name: 'Move #1 Child later' }))
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: '#2 Child' })).toHaveAttribute('aria-selected', 'true'),
  )
  expect(screen.getByRole('tab', { name: 'Extra' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getAllByLabelText('Note')[1]).toBe(note)
  expect(note).toHaveFocus()
})
