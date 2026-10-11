import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TungstenBooleanField } from '../../../design/tungsten/src/boolean-field.js'
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
describe('boolean field presentation', () => {
  it('does not apply native must-be-checked constraints to a required checkbox or switch', () => {
    for (const variant of ['checkbox', 'switch']) {
      const p = props({ type: 'boolean', variant, key: 'answer', view: { label: 'Answer' } }, false)
      const view = render(<TungstenBooleanField {...p} />)
      const input = screen.getByRole(variant, { name: /^Answer/ }) as HTMLInputElement
      expect(input).not.toHaveAttribute('required')
      expect(input).toHaveAttribute('aria-required', 'true')
      expect(input.checkValidity()).toBe(true)
      fireEvent.click(input)
      expect(p.onValueChange).toHaveBeenCalledWith(true)
      view.rerender(<TungstenBooleanField {...p} readOnly />)
      fireEvent.click(input)
      expect(p.onValueChange).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })
  it('keeps distinct radio groups independent and prevents read-only or loading edits', () => {
    const p = props(
      {
        type: 'boolean',
        variant: 'radio',
        key: 'answer',
        direction: 'row',
        view: { label: 'Answer' },
        options: [
          { value: true, label: 'A very long option label that wraps' },
          { value: false, label: 'No' },
        ],
      },
      false,
    )
    const view = render(
      <>
        <TungstenBooleanField {...p} />
        <TungstenBooleanField {...p} inputId="other" />
      </>,
    )
    const radios = screen.getAllByRole('radio', { name: 'No' })
    expect(radios[0]).toHaveAttribute('name', 'field')
    expect(radios[1]).toHaveAttribute('name', 'other')
    view.rerender(<TungstenBooleanField {...p} readOnly />)
    fireEvent.click(screen.getByRole('radio', { name: /^A very/ }))
    fireEvent.keyDown(screen.getByRole('radio', { name: 'No' }), { key: 'ArrowRight' })
    expect(p.onValueChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
    view.rerender(
      <TungstenBooleanField {...p} state={{ ...p.state, loadingSources: ['answers'] }} />,
    )
    expect(screen.getByRole('radio', { name: 'No' })).toBeDisabled()
  })
})
