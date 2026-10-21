import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { FieldRendererProps } from '../types.js'
import tungsten from '../../../../design/tungsten/src/index.js'

it('keeps newer JSON edits while older worker replies arrive, then follows core resets', async () => {
  const replies: (() => void)[] = []
  const props: FieldRendererProps = {
    field: { type: 'text', key: 'json', textarea: true, rows: 3, view: { label: 'JSON' } },
    state: { value: '{}', hidden: false, errors: [] },
    inputId: 'json',
    disabled: false,
    readOnly: false,
    required: false,
    onValueChange: vi.fn(() => new Promise<void>((resolve) => replies.push(resolve))),
  }
  const Text = tungsten.fields.text
  const view = render(<Text {...props} />)
  const input = screen.getByRole('textbox', { name: 'JSON' })
  fireEvent.change(input, { target: { value: '{"name": "A"}' } })
  expect(input).toHaveValue('{"name": "A"}')
  fireEvent.change(input, { target: { value: '{"name": "Ada"}' } })
  view.rerender(<Text {...props} state={{ ...props.state, value: '{"name": "A"}' }} />)
  await act(async () => replies[0]())
  expect(input).toHaveValue('{"name": "Ada"}')
  view.rerender(<Text {...props} state={{ ...props.state, value: '{"name": "Ada"}' }} />)
  await act(async () => replies[1]())
  expect(input).toHaveValue('{"name": "Ada"}')
  view.rerender(<Text {...props} />)
  expect(input).toHaveValue('{}')
})
