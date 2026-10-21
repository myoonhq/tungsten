import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TungstenTextField } from '../../../design/tungsten/src/text-field.js'
import type { FieldRendererProps } from './types.js'

afterEach(cleanup)
function props(
  field: FieldRendererProps['field'],
  value: FieldRendererProps['state']['value'] = null,
): FieldRendererProps {
  return {
    field,
    state: { value, hidden: false, errors: [] },
    inputId: 'field',
    required: true,
    disabled: false,
    readOnly: false,
    onValueChange: vi.fn(),
  }
}
describe('field variant presentation', () => {
  it('formats JSON through the shared textarea without losing malformed input', () => {
    const p = props(
      {
        type: 'text',
        key: 'settings',
        textarea: true,
        rows: 10,
        view: { label: 'Settings', format: 'json' },
      },
      '{"name":"Ada"}',
    )
    const view = render(<TungstenTextField {...p} />)
    const input = screen.getByRole('textbox', { name: /^Settings/ })
    expect(input).toHaveAttribute('rows', '10')
    fireEvent.click(screen.getByRole('button', { name: 'Format JSON' }))
    expect(p.onValueChange).toHaveBeenLastCalledWith('{\n  "name": "Ada"\n}')
    view.rerender(<TungstenTextField {...p} state={{ ...p.state, value: '{unfinished' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Format JSON' }))
    expect(input).toHaveValue('{unfinished')
    expect(screen.getByText('Enter valid JSON before formatting.')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    view.rerender(<TungstenTextField {...p} readOnly />)
    expect(screen.getByRole('button', { name: 'Format JSON' })).toBeDisabled()
  })

  it('keeps native password masking across draft changes, disabled and read-only states', () => {
    const p = props(
      { type: 'text', variant: 'password', key: 'secret', view: { label: 'Password' } },
      'saved',
    )
    const view = render(<TungstenTextField {...p} />)
    const input = screen.getByLabelText(/^Password/)
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('saved')
    view.rerender(
      <TungstenTextField {...p} readOnly disabled state={{ ...p.state, value: 'fetched' }} />,
    )
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('fetched')
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('readonly')
    expect(screen.queryByText('fetched')).not.toBeInTheDocument()
  })
  it('uses multiline text controls and preserves literal line breaks on editing', () => {
    const p = props({
      type: 'text',
      textarea: true,
      rows: 5,
      key: 'notes',
      view: { label: 'Notes' },
    })
    render(<TungstenTextField {...p} />)
    const input = screen.getByRole('textbox', { name: /^Notes/ })
    expect(input.tagName).toBe('TEXTAREA')
    expect(input).toHaveAttribute('rows', '5')
    expect(input).toHaveStyle({ resize: 'vertical' })
    fireEvent.change(input, { target: { value: 'one\ntwo' } })
    expect(p.onValueChange).toHaveBeenCalledWith('one\ntwo')
  })
})
