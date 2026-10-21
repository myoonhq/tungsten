import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tungsten } from './Tungsten.js'
import tungsten from '../../../design/tungsten/src/index.js'
import type {
  FormState,
  GroupRendererProps,
  TungstenComponent,
  TungstenGroup,
  TungstenSchema,
} from './types.js'
import { fieldsOf } from '../../../api/src/types.js'

const engine = vi.hoisted(() => ({
  load: vi.fn(),
  patch: vi.fn(),
  validate: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('../../../api/src/engine/client', () => ({
  EngineClient: class {
    load = engine.load
    patch = engine.patch
    validate = engine.validate
    destroy = engine.destroy
  },
}))

function group(
  key: string,
  variant: 'basic' | 'sectioned',
  type: string,
  subform: TungstenComponent[],
  label?: string,
): TungstenGroup {
  return {
    type: 'group',
    variant,
    key,
    render: { type, settings: {} },
    subform,
    view: label ? { label } : undefined,
  }
}
function field(key: string, label: string) {
  return { type: 'text', key, view: { label }, validators: [{ kind: 'required' }] }
}
function schema(...form: TungstenComponent[]): TungstenSchema {
  return { schemaVersion: 'sprout', form }
}
function stateFor(input: TungstenSchema): FormState {
  return {
    fields: Object.fromEntries(
      fieldsOf(input.form).map((f) => [f.key, { value: f.key, hidden: false, errors: [] }]),
    ),
  }
}
function load(input: TungstenSchema, state = stateFor(input)) {
  engine.load.mockResolvedValue({ schema: input, state })
  return state
}
function tabsSchema(render = 'tabs') {
  return schema(
    group(
      'person',
      'sectioned',
      render,
      [
        group('person.name', 'basic', 'group', [field('person.name.value', 'Name')], 'Personal'),
        group(
          'person.contact',
          'basic',
          'group',
          [field('person.contact.email', 'Email')],
          'Contact',
        ),
      ],
      'Registration',
    ),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('groups', () => {
  it('renders every nested leaf once without requiring group runtime state', async () => {
    const input = schema(
      group('person', 'basic', 'card', [
        field('person.name', 'Name'),
        group('person.address', 'basic', 'row', [field('person.address.city', 'City')]),
      ]),
    )
    load(input)
    render(<Tungsten schema={input} onSubmit={vi.fn()} />)
    expect(await screen.findByLabelText(/Name/)).toBeVisible()
    expect(screen.getAllByLabelText(/City/)).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the schema returned by core, rather than an unvalidated input tree', async () => {
    const input = schema(field('person.name', 'Original'))
    load(schema(field('person.name', 'Validated')))
    render(<Tungsten schema={input} onSubmit={vi.fn()} />)
    expect(await screen.findByLabelText(/Validated/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Original')).not.toBeInTheDocument()
  })

  it.each(['tabs', 'segmented-view', 'wizard', 'stepper', 'pages', 'carousel'])(
    'submits all section values with %s rendering',
    async (type) => {
      const input = tabsSchema(type)
      const state = load(input)
      engine.validate.mockResolvedValue({ valid: true, state })
      const onSubmit = vi.fn()
      render(<Tungsten schema={input} onSubmit={onSubmit} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith({
          'person.name.value': 'person.name.value',
          'person.contact.email': 'person.contact.email',
        }),
      )
    },
  )

  it('retains inactive values, supports keyboard tabs, and patches canonical keys', async () => {
    const input = tabsSchema()
    const state = load(input)
    engine.patch.mockResolvedValue({ state })
    render(<Tungsten schema={input} onSubmit={vi.fn()} />)
    const personal = await screen.findByRole('tab', { name: 'Personal' })
    const contact = screen.getByRole('tab', { name: 'Contact' })
    expect(screen.getByLabelText(/Email/)).not.toBeVisible()
    fireEvent.keyDown(personal, { key: 'ArrowRight' })
    expect(contact).toHaveAttribute('aria-selected', 'true')
    expect(contact).toHaveFocus()
    expect(screen.getByLabelText(/Email/)).toBeVisible()
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'Ada' } })
    expect(engine.patch).toHaveBeenCalledWith({
      kind: 'set_value',
      key: 'person.contact.email',
      value: 'Ada',
    })
    fireEvent.keyDown(contact, { key: 'Home' })
    expect(personal).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByLabelText(/Email/)).toHaveValue('person.contact.email'))
  })

  it('reveals and focuses invalid nested inactive and collapsed sections on each submit', async () => {
    const input = schema(
      group('flow', 'sectioned', 'wizard', [
        group('flow.first', 'basic', 'group', [field('flow.first.name', 'Name')], 'First'),
        group(
          'flow.second',
          'basic',
          'group',
          [
            group('flow.second.tabs', 'sectioned', 'tabs', [
              group(
                'flow.second.tabs.one',
                'basic',
                'group',
                [field('flow.second.tabs.one.city', 'City')],
                'Address',
              ),
              group(
                'flow.second.tabs.two',
                'basic',
                'accordion',
                [field('flow.second.tabs.two.email', 'Email')],
                'Contact',
              ),
            ]),
          ],
          'Second',
        ),
      ]),
    )
    const state = load(input)
    const invalid = structuredClone(state)
    invalid.fields['flow.second.tabs.two.email'].errors = ['Email is required.']
    engine.validate.mockResolvedValue({ valid: false, state: invalid })
    const onSubmit = vi.fn()
    render(<Tungsten schema={input} onSubmit={onSubmit} />)
    const submit = await screen.findByRole('button', { name: 'Submit' })
    fireEvent.click(submit)
    await waitFor(() => expect(screen.getByLabelText(/Email/)).toBeVisible())
    await waitFor(() => expect(screen.getByLabelText(/Email/)).toHaveFocus())
    expect(screen.getByRole('tab', { name: /Contact/ })).toHaveAttribute('aria-selected', 'true')
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Address' }))
    expect(screen.getByLabelText(/Email/)).not.toBeVisible()
    fireEvent.click(submit)
    await waitFor(() => expect(screen.getByLabelText(/Email/)).toBeVisible())
    await waitFor(() => expect(screen.getByLabelText(/Email/)).toHaveFocus())
  })

  it('keeps navigation independent of validation and never submits from Next', async () => {
    const input = tabsSchema('wizard')
    load(input)
    render(<Tungsten schema={input} onSubmit={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText(/Email/)).toBeVisible()
    expect(engine.validate).not.toHaveBeenCalled()
  })

  it('focuses the invalid field after a native dialog opens inside an inactive tab', async () => {
    const prototype = HTMLDialogElement.prototype
    const original = Object.getOwnPropertyDescriptor(prototype, 'showModal')
    Object.defineProperty(prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
        this.querySelector('button')?.focus()
      },
    })
    try {
      const input = schema(
        group('person', 'sectioned', 'tabs', [
          group(
            'person.profile',
            'basic',
            'group',
            [field('person.profile.name', 'Name')],
            'Personal',
          ),
          group(
            'person.contact',
            'basic',
            'group',
            [
              group(
                'person.contact.dialog',
                'basic',
                'modal',
                [
                  field('person.contact.dialog.name', 'Modal name'),
                  field('person.contact.dialog.email', 'Modal email'),
                ],
                'Contact details',
              ),
            ],
            'Contact',
          ),
        ]),
      )
      const invalid = load(input)
      invalid.fields['person.contact.dialog.email'].errors = ['Email is required.']
      engine.validate.mockResolvedValue({ valid: false, state: invalid })
      render(<Tungsten schema={input} onSubmit={vi.fn()} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
      await waitFor(() => expect(screen.getByLabelText(/Modal email/)).toHaveFocus())
      expect(screen.getByRole('dialog', { name: 'Contact details' })).toHaveAttribute('open')
      expect(screen.getByRole('tab', { name: /Contact/ })).toHaveAttribute('aria-selected', 'true')
    } finally {
      if (original) Object.defineProperty(prototype, 'showModal', original)
      else Reflect.deleteProperty(prototype, 'showModal')
    }
  })

  it('reports missing nested renderers before rendering a partial form', async () => {
    const input = schema(group('person', 'basic', 'card', [field('person.name', 'Name')]))
    load(input)
    render(<Tungsten schema={input} design={{ ...tungsten, groups: {} }} onSubmit={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "no renderer for group render type 'card'",
    )
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('checks the selected design renderer family', async () => {
    const input = tabsSchema()
    load(input)
    render(
      <Tungsten
        schema={input}
        design={{
          ...tungsten,
          groups: {
            ...tungsten.groups,
            tabs: { variant: 'basic', Renderer: () => null },
          },
        }}
        onSubmit={vi.fn()}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "does not support variant 'sectioned'",
    )
  })

  it('supports a custom group design renderer through registration', async () => {
    const input = schema(group('person', 'basic', 'custom', [field('person.name', 'Name')]))
    load(input)
    function Custom({ children }: GroupRendererProps) {
      return <div data-testid="custom">{children}</div>
    }
    render(
      <Tungsten
        schema={input}
        design={{
          ...tungsten,
          groups: {
            ...tungsten.groups,
            custom: { variant: 'basic', Renderer: Custom },
          },
        }}
        onSubmit={vi.fn()}
      />,
    )
    expect(within(await screen.findByTestId('custom')).getByLabelText(/Name/)).toBeVisible()
  })

  it('reports missing leaf state but never expects synthetic group values', async () => {
    const input = tabsSchema()
    load(input, { fields: {} })
    render(<Tungsten schema={input} onSubmit={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "no state for field 'person.name.value'",
    )
  })

  it('rejects duplicate concurrent submit attempts while validation is pending', async () => {
    const input = tabsSchema()
    load(input)
    let finish!: (value: { valid: boolean; state: FormState }) => void
    engine.validate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const onSubmit = vi.fn()
    render(<Tungsten schema={input} onSubmit={onSubmit} />)
    const submit = await screen.findByRole('button', { name: 'Submit' })
    const form = submit.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(engine.validate).toHaveBeenCalledTimes(1)
    finish({ valid: true, state: stateFor(input) })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  })

  it('reuses the worker across presentation changes and submits the returned preserved state', async () => {
    const input = tabsSchema()
    const state = stateFor(input)
    state.fields['person.name.value'].value = 'Entered name'
    engine.load.mockImplementation(async (loaded: TungstenSchema) => ({ schema: loaded, state }))
    engine.validate.mockResolvedValue({ valid: true, state })
    const onSubmit = vi.fn()
    const view = render(<Tungsten schema={input} onSubmit={onSubmit} />)
    expect(await screen.findByLabelText(/Name/)).toHaveValue('Entered name')
    const changed = tabsSchema('wizard')
    view.rerender(<Tungsten schema={changed} onSubmit={onSubmit} />)
    expect(await screen.findByRole('button', { name: 'Next' })).toBeEnabled()
    expect(engine.destroy).not.toHaveBeenCalled()
    expect(engine.load).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText(/Name/)).toHaveValue('Entered name')
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ 'person.name.value': 'Entered name' }),
      ),
    )
  })

  it('ignores obsolete validations after replacing the schema', async () => {
    const input = tabsSchema()
    engine.load.mockImplementation(async (loaded: TungstenSchema) => ({
      schema: loaded,
      state: stateFor(loaded),
    }))
    let finish!: (value: { valid: boolean; state: FormState }) => void
    engine.validate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const onSubmit = vi.fn()
    const view = render(<Tungsten schema={input} onSubmit={onSubmit} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
    const replacement = schema(field('new.name', 'Replacement'))
    view.rerender(<Tungsten schema={replacement} onSubmit={onSubmit} />)
    expect(await screen.findByLabelText(/Replacement/)).toBeVisible()
    finish({ valid: true, state: stateFor(input) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument()
  })

  it('invalidates old patches even when the same schema object is later selected again', async () => {
    const input = tabsSchema()
    engine.load.mockImplementation(async (loaded: TungstenSchema) => ({
      schema: loaded,
      state: stateFor(loaded),
    }))
    let finish!: (value: { state: FormState }) => void
    engine.patch.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const view = render(<Tungsten schema={input} onSubmit={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: 'Pending' } })
    const replacement = tabsSchema('wizard')
    view.rerender(<Tungsten schema={replacement} onSubmit={vi.fn()} />)
    await screen.findByRole('button', { name: 'Next' })
    view.rerender(<Tungsten schema={input} onSubmit={vi.fn()} />)
    await screen.findByRole('tab', { name: 'Personal' })
    const stale = stateFor(input)
    stale.fields['person.name.value'].value = 'Stale result'
    finish({ state: stale })
    await waitFor(() => expect(screen.getByLabelText(/Name/)).toHaveValue('person.name.value'))
  })
})
