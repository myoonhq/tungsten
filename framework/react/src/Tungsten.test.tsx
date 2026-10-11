import { TungstenLang } from './i18n.js'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tungsten } from './Tungsten'
import type {
  DesignFormProps,
  DesignMessageProps,
  FieldRendererProps,
  FormState,
  TungstenDesign,
  TungstenSchema,
} from './types'

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

const requiredNameSchema = {
  schemaVersion: 'sprout',
  form: [
    {
      key: 'name',
      type: 'text',
      view: { label: 'Name' },
      validators: [{ kind: 'required' }],
    },
  ],
} satisfies TungstenSchema

describe('Tungsten', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    engine.load.mockImplementation(async (schema: TungstenSchema) => ({
      schema,
      kind: 'loaded',
      state: { fields: {} },
    }))
  })

  it('reports evaluated state after loading and patches without re-emitting for callback identity changes', async () => {
    engine.load.mockImplementation(async (schema: TungstenSchema) => ({
      schema,
      state: formState(null, ['Required']),
    }))
    engine.patch.mockResolvedValue({ state: formState('Ada'), patches: [] })
    const first = vi.fn()
    const second = vi.fn()
    const onSubmit = vi.fn()
    const view = render(
      <Tungsten schema={requiredNameSchema} onSubmit={onSubmit} onStateChange={first} />,
    )
    await waitFor(() =>
      expect(first).toHaveBeenCalledWith({
        schema: requiredNameSchema,
        state: formState(null, ['Required']),
        values: { name: null },
        valid: false,
      }),
    )
    const count = first.mock.calls.length
    view.rerender(
      <Tungsten schema={requiredNameSchema} onSubmit={onSubmit} onStateChange={second} />,
    )
    expect(first).toHaveBeenCalledTimes(count)
    expect(second).not.toHaveBeenCalled()
    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: 'Ada' } })
    await waitFor(() =>
      expect(second).toHaveBeenCalledWith({
        schema: requiredNameSchema,
        state: formState('Ada'),
        values: { name: 'Ada' },
        valid: true,
      }),
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('loads supplied values and displays load-time validation without submission', async () => {
    const initialValues = { name: 'Existing' }
    engine.load.mockImplementation(async (schema: TungstenSchema) => ({
      schema,
      kind: 'loaded',
      state: formState('Existing', ['Loaded validation error']),
    }))
    const onSubmit = vi.fn()
    render(
      <Tungsten schema={requiredNameSchema} initialValues={initialValues} onSubmit={onSubmit} />,
    )
    expect(await screen.findByLabelText(/Name/)).toHaveValue('Existing')
    expect(screen.getByText('Loaded validation error')).toBeInTheDocument()
    expect(engine.load).toHaveBeenCalledWith(requiredNameSchema, initialValues, {
      preserveState: true,
    })
    expect(engine.patch).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('loads defaults when initialValues is omitted or reset to null', async () => {
    engine.load.mockImplementation(
      async (schema: TungstenSchema, values: { name: string } | null) => ({
        schema,
        kind: 'loaded',
        state: formState(values?.name ?? 'Default'),
      }),
    )
    const view = render(<Tungsten schema={requiredNameSchema} onSubmit={vi.fn()} />)
    expect(await screen.findByLabelText(/Name/)).toHaveValue('Default')
    expect(engine.load).toHaveBeenCalledWith(requiredNameSchema, null, { preserveState: true })
    view.rerender(
      <Tungsten
        schema={requiredNameSchema}
        initialValues={{ name: 'Existing' }}
        onSubmit={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByLabelText(/Name/)).toHaveValue('Existing'))
    view.rerender(<Tungsten schema={requiredNameSchema} initialValues={null} onSubmit={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText(/Name/)).toHaveValue('Default'))
  })

  it('ignores obsolete value loads and patches when values change on the same schema', async () => {
    const firstValues = { name: 'First' }
    const secondValues = { name: 'Second' }
    let completeOldPatch!: (response: unknown) => void
    let completeOldLoad!: (response: unknown) => void
    engine.load.mockResolvedValueOnce({ schema: requiredNameSchema, state: formState('First') })
    engine.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOldPatch = resolve
        }),
    )
    const view = render(
      <Tungsten schema={requiredNameSchema} initialValues={firstValues} onSubmit={vi.fn()} />,
    )
    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: 'Old edit' } })
    engine.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOldLoad = resolve
        }),
    )
    view.rerender(
      <Tungsten
        schema={requiredNameSchema}
        initialValues={{ name: 'Pending' }}
        onSubmit={vi.fn()}
      />,
    )
    await waitFor(() => expect(engine.load).toHaveBeenCalledTimes(2))
    engine.load.mockResolvedValueOnce({ schema: requiredNameSchema, state: formState('Second') })
    view.rerender(
      <Tungsten schema={requiredNameSchema} initialValues={secondValues} onSubmit={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByLabelText(/Name/)).toHaveValue('Second'))
    completeOldLoad({ schema: requiredNameSchema, state: formState('Pending') })
    completeOldPatch({ state: formState('Old edit') })
    await waitFor(() => expect(screen.getByLabelText(/Name/)).toHaveValue('Second'))
  })

  it('submits the validated worker snapshot instead of stale React state', async () => {
    engine.load.mockImplementation(async (schema: TungstenSchema) => ({
      schema,
      kind: 'loaded',
      state: formState(null),
    }))
    engine.patch.mockResolvedValue({
      kind: 'patched',
      patches: [],
      state: formState('Ada'),
    })
    engine.validate.mockResolvedValue({
      kind: 'validated',
      valid: true,
      state: formState('Ada'),
    })
    const onSubmit = vi.fn()

    render(<Tungsten schema={requiredNameSchema} onSubmit={onSubmit} />)

    fireEvent.change(await screen.findByLabelText(/Name/), {
      target: { value: 'Ada' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: 'Ada' })
    })
  })

  it('shows full-form validation errors and does not submit invalid state', async () => {
    engine.load.mockImplementation(async (schema: TungstenSchema) => ({
      schema,
      kind: 'loaded',
      state: formState(null),
    }))
    engine.validate.mockResolvedValue({
      kind: 'validated',
      valid: false,
      state: formState(null, ['This field is required.']),
    })
    const onSubmit = vi.fn()

    render(<Tungsten schema={requiredNameSchema} onSubmit={onSubmit} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))

    expect(await screen.findByText('This field is required.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders a registered custom type without changing Tungsten', async () => {
    const schema = {
      schemaVersion: 'sprout',
      form: [
        {
          key: 'code',
          type: 'test-code',
          view: { label: 'Code' },
        },
      ],
    } satisfies TungstenSchema
    engine.load.mockImplementation(async (schema: TungstenSchema) => ({
      schema,
      kind: 'loaded',
      state: {
        fields: {
          code: { value: 'ABC', hidden: false, errors: [] },
        },
      },
    }))

    render(<Tungsten schema={schema} design={testDesign(TestCodeField)} onSubmit={vi.fn()} />)

    expect(await screen.findByTestId('test-code')).toHaveTextContent('ABC')
  })

  it('reports an exact missing-renderer error from the selected design', async () => {
    const schema = {
      schemaVersion: 'sprout',
      form: [{ key: 'code', type: 'unknown-widget' }],
    } satisfies TungstenSchema

    render(<Tungsten schema={schema} design={testDesign()} onSubmit={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Design 'test' has no renderer for field type 'unknown-widget'.",
    )
  })
})

function formState(value: string | null, errors: string[] = []): FormState {
  return {
    fields: {
      name: {
        value,
        hidden: false,
        errors,
      },
    },
  }
}

function TestCodeField({ state }: FieldRendererProps) {
  return <div data-testid="test-code">{state.value}</div>
}

function TestForm({ children, onSubmit }: DesignFormProps) {
  return <form onSubmit={onSubmit}>{children}</form>
}

function TestMessage({ message }: DesignMessageProps) {
  return (
    <div role="alert">
      <TungstenLang>{message}</TungstenLang>
    </div>
  )
}

function testDesign(renderer?: ComponentType<FieldRendererProps>): TungstenDesign {
  return {
    name: 'test',
    fields: renderer ? { 'test-code': renderer } : {},
    Form: TestForm,
    Loading: TestMessage,
    Failure: TestMessage,
  }
}
