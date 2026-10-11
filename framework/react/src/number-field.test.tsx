import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TungstenNumberField } from '../../../design/tungsten/src/number-field.js'
import type { FieldRendererProps } from './types.js'
const props = (): FieldRendererProps => ({
  field: { type: 'number', key: 'number', view: { label: 'Number' } },
  state: { value: 0, hidden: false, errors: [] },
  inputId: 'number',
  required: true,
  disabled: false,
  readOnly: false,
  onValueChange: vi.fn(),
})
describe('number field', () => {
  it('preserves required zero, decimals and negative values; an empty entry means null', () => {
    const p = props()
    render(<TungstenNumberField {...p} />)
    const input = screen.getByLabelText(/^Number/)
    expect(input).toHaveValue(0)
    expect(input).toBeRequired()
    fireEvent.change(input, { target: { value: '-12.5' } })
    expect(p.onValueChange).toHaveBeenLastCalledWith(-12.5)
    fireEvent.change(input, { target: { value: '' } })
    expect(p.onValueChange).toHaveBeenLastCalledWith(null)
  })
  it('exposes disabled/readonly and validation errors accessibly without changing data', () => {
    const p = props()
    render(
      <TungstenNumberField
        {...p}
        disabled
        readOnly
        state={{ ...p.state, errors: ['Too small'] }}
      />,
    )
    const input = screen.getByLabelText(/^Number/)
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Too small')).toBeInTheDocument()
    expect(p.onValueChange).not.toHaveBeenCalled()
  })
})
