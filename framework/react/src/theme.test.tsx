import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tungsten } from './Tungsten.js'
import { TungstenThemeProvider, useTungstenColorScheme } from './theme.js'
import tungsten from '../../../design/tungsten/src/index.js'
import bootstrap from '../../../design/bootstrap/src/index.js'
import material from '../../../design/material/src/index.js'
import type { TungstenSchema } from './types.js'

const engine = vi.hoisted(() => ({ load: vi.fn(), patch: vi.fn(), destroy: vi.fn() }))
vi.mock('../../../api/src/engine/client.js', () => ({
  EngineClient: class {
    load = engine.load
    patch = engine.patch
    destroy = engine.destroy
  },
}))
const schema: TungstenSchema = {
  schemaVersion: 'sprout',
  form: [{ type: 'text', key: 'name', view: { label: 'Name' } }],
}
const state = { fields: { name: { value: 'Ada', hidden: false, errors: ['Check this name'] } } }

beforeEach(() => {
  vi.clearAllMocks()
  engine.load.mockResolvedValue({ kind: 'loaded', schema, state })
  engine.patch.mockResolvedValue({ state })
})

describe.each([tungsten, bootstrap, material])('$name color schemes', (design) => {
  it('defaults to light, inherits a provider and allows an independent nested override', () => {
    function Scheme({ label }: { label: string }) {
      return <output aria-label={label}>{useTungstenColorScheme()}</output>
    }
    render(
      <>
        <Scheme label="Default" />
        <TungstenThemeProvider colorScheme="dark">
          <Scheme label="Inherited" />
          <TungstenThemeProvider>
            <Scheme label="Nested" />
          </TungstenThemeProvider>
          <TungstenThemeProvider colorScheme="light">
            <Scheme label="Override" />
          </TungstenThemeProvider>
        </TungstenThemeProvider>
      </>,
    )
    expect(screen.getByLabelText('Default')).toHaveTextContent('light')
    expect(screen.getByLabelText('Inherited')).toHaveTextContent('dark')
    expect(screen.getByLabelText('Nested')).toHaveTextContent('dark')
    expect(screen.getByLabelText('Override')).toHaveTextContent('light')
  })

  it('changes the scheme without reloading, publishing state or losing field errors and focus', async () => {
    const observer = vi.fn()
    const view = render(<Tungsten design={design} schema={schema} onStateChange={observer} />)
    const field = await screen.findByLabelText('Name')
    await waitFor(() => expect(observer).toHaveBeenCalledTimes(1))
    field.focus()
    const emissions = observer.mock.calls.length
    const form = field.closest('form')!
    expect(form).toHaveAttribute('data-tg-color-scheme', 'light')
    view.rerender(
      <Tungsten design={design} schema={schema} colorScheme="dark" onStateChange={observer} />,
    )
    expect(field.closest('form')).toBe(form)
    expect(form).toHaveAttribute('data-tg-color-scheme', 'dark')
    expect(field).toHaveValue('Ada')
    expect(field).toHaveFocus()
    expect(screen.getByText('Check this name')).toBeVisible()
    expect(engine.load).toHaveBeenCalledTimes(1)
    expect(engine.patch).not.toHaveBeenCalled()
    expect(observer).toHaveBeenCalledTimes(emissions)
  })

  it('updates inherited forms while preserving explicitly selected sibling schemes', async () => {
    function Forms({ dark }: { dark: boolean }) {
      return (
        <TungstenThemeProvider colorScheme={dark ? 'dark' : 'light'}>
          <Tungsten design={design} schema={schema} />
          <Tungsten design={design} schema={schema} colorScheme="light" />
        </TungstenThemeProvider>
      )
    }
    const view = render(<Forms dark />)
    await waitFor(() => expect(screen.getAllByLabelText('Name')).toHaveLength(2))
    expect(
      screen.getAllByLabelText('Name').map((field) => field.closest('form')!.dataset.tgColorScheme),
    ).toEqual(['dark', 'light'])
    view.rerender(<Forms dark={false} />)
    expect(
      screen.getAllByLabelText('Name').map((field) => field.closest('form')!.dataset.tgColorScheme),
    ).toEqual(['light', 'light'])
    expect(engine.load).toHaveBeenCalledTimes(2)
  })

  it('themes loading and failure feedback even when no form is available', async () => {
    engine.load.mockRejectedValue(new Error('Cannot load this form'))
    render(<Tungsten design={design} schema={schema} colorScheme="dark" />)
    expect(screen.getByRole('status')).toHaveAttribute('data-tg-color-scheme', 'dark')
    expect(await screen.findByRole('alert')).toHaveAttribute('data-tg-color-scheme', 'dark')
  })

  it('lets standalone design components inherit the selected scheme', () => {
    render(
      <TungstenThemeProvider colorScheme="dark">
        <design.Form submitting={false} error={null} onSubmit={vi.fn()}>
          Content
        </design.Form>
        <design.Loading />
        <design.Failure />
      </TungstenThemeProvider>,
    )
    expect(screen.getByRole('button', { name: 'Submit' }).closest('form')).toHaveAttribute(
      'data-tg-color-scheme',
      'dark',
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-tg-color-scheme', 'dark')
    expect(screen.getByRole('alert')).toHaveAttribute('data-tg-color-scheme', 'dark')
  })
})
