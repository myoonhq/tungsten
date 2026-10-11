import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TungstenSelectField } from '../../../design/tungsten/src/select-field.js'
import type { FieldRendererProps } from './types.js'

afterEach(cleanup)
function setup(overrides: Partial<FieldRendererProps> = {}) {
  const props: FieldRendererProps = {
    field: { type: 'select', key: 'city', view: { label: 'City', description: 'Pick a city' } },
    state: {
      value: null,
      hidden: false,
      errors: [],
      options: [
        { value: 'BA', label: 'Bratislava' },
        { value: 'KE', label: 'Košice' },
      ],
    },
    inputId: 'city',
    required: true,
    disabled: false,
    readOnly: false,
    onValueChange: vi.fn(),
    ...overrides,
  }
  const view = render(<TungstenSelectField {...props} />)
  return { ...view, props, trigger: screen.getByRole('combobox', { name: 'City' }) }
}

describe('select interaction', () => {
  it('opens a labelled listbox, selects by pointer and permits clearing', () => {
    const { trigger, props, rerender } = setup()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox', { name: 'City' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Bratislava' }))
    expect(props.onValueChange).toHaveBeenLastCalledWith('BA')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    rerender(<TungstenSelectField {...props} state={{ ...props.state, value: 'BA' }} />)
    expect(trigger).toHaveTextContent('Bratislava')
    fireEvent.click(trigger)
    expect(screen.getByRole('option', { name: 'Bratislava' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.click(screen.getByRole('option', { name: 'Select…' }))
    expect(props.onValueChange).toHaveBeenLastCalledWith(null)
  })

  it('supports arrows, boundaries, Enter and Escape without changing on navigation', () => {
    const { trigger, props } = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger).toHaveAttribute('aria-activedescendant', 'city-options-1')
    fireEvent.keyDown(trigger, { key: 'End' })
    expect(trigger).toHaveAttribute('aria-activedescendant', 'city-options-2')
    expect(props.onValueChange).not.toHaveBeenCalled()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(props.onValueChange).toHaveBeenCalledWith('KE')
    expect(trigger).toHaveFocus()
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    fireEvent.keyDown(trigger, { key: 'Home' })
    expect(trigger).toHaveAttribute('aria-activedescendant', 'city-options-0')
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(props.onValueChange).toHaveBeenCalledTimes(1)
  })

  it('finds options by typing and uses Space to open and select', () => {
    const { trigger, props } = setup()
    fireEvent.keyDown(trigger, { key: 'k' })
    fireEvent.keyDown(trigger, { key: 'o' })
    expect(trigger).toHaveAttribute('aria-activedescendant', 'city-options-2')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(props.onValueChange).toHaveBeenCalledWith('KE')
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(props.onValueChange).toHaveBeenLastCalledWith(null)
  })

  it('closes on outside click, Tab or leaving focus', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Tab' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.blur(trigger, { relatedTarget: document.body })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes when options reload, uses an accessible spinner and stays closed afterward', () => {
    const { props, trigger, rerender } = setup()
    fireEvent.click(trigger)
    rerender(
      <TungstenSelectField {...props} state={{ ...props.state, loadingSources: ['cities'] }} />,
    )
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading options' })).toBeInTheDocument()
    rerender(
      <TungstenSelectField
        {...props}
        state={{ ...props.state, options: [{ value: 'PR', label: 'Prague' }] }}
      />,
    )
    expect(trigger).toBeEnabled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.getByRole('option', { name: 'Prague' })).toBeInTheDocument()
  })

  it('keeps unavailable values visible, exposes validation and respects read-only state', () => {
    const { trigger } = setup({
      readOnly: true,
      state: { value: 'old', hidden: false, errors: ['Select an available option.'], options: [] },
    })
    expect(trigger).toHaveTextContent('old (Unavailable)')
    expect(trigger).toBeEnabled()
    expect(trigger).toHaveAttribute('aria-readonly', 'true')
    trigger.focus()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAttribute('aria-describedby', 'city-description city-errors')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('multiple select interaction', () => {
  const options = [
    { value: 'BA', label: 'Bratislava' },
    { value: 'KE', label: 'Košice' },
    { value: 'PR', label: 'Prague' },
  ]
  function multi(
    values: string[] = [],
    onValueChange: FieldRendererProps['onValueChange'] = vi.fn(),
  ) {
    return setup({
      field: { type: 'select', key: 'city', multiple: true, view: { label: 'City' } },
      state: { value: values, hidden: false, errors: [], options },
      onValueChange,
    })
  }
  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  it('keeps the menu open, checks all selections, and composes rapid toggles before acknowledgements', async () => {
    const ack = deferred(),
      change = vi.fn(() => ack.promise)
    const { trigger, props, rerender } = multi([], change)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: 'Bratislava' }))
    fireEvent.click(screen.getByRole('option', { name: 'Košice' }))
    expect(change.mock.calls).toEqual([[['BA']], [['BA', 'KE']]])
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true')
    expect(screen.getByRole('option', { name: 'Bratislava' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('option', { name: 'Košice' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('option', { name: 'Bratislava' }))
    expect(change).toHaveBeenLastCalledWith(['KE'])
    rerender(
      <TungstenSelectField
        {...props}
        state={{ ...props.state, value: ['KE'], options: structuredClone(options) }}
      />,
    )
    ack.resolve()
    await screen.findByRole('button', { name: 'Remove Košice' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('does not resurrect chips while rapid removals and clear-all await delayed core echoes', async () => {
    const a = deferred(),
      b = deferred(),
      c = deferred()
    const change = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise)
      .mockReturnValueOnce(c.promise)
    const { trigger, props, rerender } = multi(['BA', 'KE', 'PR'], change)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bratislava' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Košice' }))
    expect(change.mock.calls).toEqual([[['KE', 'PR']], [['PR']]])
    rerender(
      <TungstenSelectField
        {...props}
        state={{ ...props.state, value: ['KE', 'PR'], options: structuredClone(options) }}
      />,
    )
    a.resolve()
    expect(screen.queryByRole('button', { name: 'Remove Košice' })).not.toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(change).toHaveBeenLastCalledWith([])
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    rerender(<TungstenSelectField {...props} state={{ ...props.state, value: [] }} />)
    b.resolve()
    c.resolve()
  })

  it('removes a chip without opening a closed menu and restores focus to the input', () => {
    const { trigger } = multi(['BA'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bratislava' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('uses the keyboard to toggle a selection without closing, and safely handles an empty options list', () => {
    const ack = deferred(),
      change = vi.fn(() => ack.promise)
    const { trigger, props, rerender } = multi([], change)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(change).toHaveBeenLastCalledWith(['BA'])
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(change).toHaveBeenLastCalledWith([])
    ack.resolve()
    rerender(<TungstenSelectField {...props} state={{ ...props.state, options: [] }} />)
    fireEvent.keyDown(trigger, { key: 'End' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByText('No options available')).toBeInTheDocument()
    expect(trigger).not.toHaveAttribute('aria-activedescendant')
    expect(change).toHaveBeenCalledTimes(2)
  })

  it('disables removal and clear while loading and does not reopen even when identical options return', () => {
    const { trigger, props, rerender } = multi(['BA'])
    fireEvent.click(trigger)
    rerender(
      <TungstenSelectField {...props} state={{ ...props.state, loadingSources: ['cities'] }} />,
    )
    expect(screen.getByRole('button', { name: 'Remove Bratislava' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
    expect(screen.getByRole('status', { name: 'Loading options' })).toBeInTheDocument()
    rerender(<TungstenSelectField {...props} />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('retains unavailable selected values as removable chips', () => {
    const { trigger } = multi(['old', 'BA'])
    expect(screen.getByRole('button', { name: 'Remove old (Unavailable)' })).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.getByRole('option', { name: 'Bratislava' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument()
  })
})

it('bounds a 10,000-option menu while keeping End/Home, typeahead and active-descendant selection available', () => {
  const options = Array.from({ length: 10000 }, (_, index) => ({
    value: `v${index}`,
    label: `Option ${index}`,
  }))
  const change = vi.fn()
  const { trigger, props, rerender } = setup({
    state: { value: null, hidden: false, errors: [], options },
    onValueChange: change,
  })
  fireEvent.click(trigger)
  expect(screen.getAllByRole('option').length).toBeLessThan(60)
  fireEvent.keyDown(trigger, { key: 'End' })
  const last = screen.getByRole('option', { name: 'Option 9999', exact: true })
  expect(last).toHaveAttribute('aria-posinset', '10001')
  expect(last).toHaveAttribute('aria-setsize', '10001')
  expect(trigger).toHaveAttribute('aria-activedescendant', last.id)
  // Equal cloned options do not close the menu or lose its active row.
  rerender(
    <TungstenSelectField
      {...props}
      state={{ ...props.state, options: structuredClone(options) }}
    />,
  )
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  fireEvent.keyDown(trigger, { key: 'Enter' })
  expect(change).toHaveBeenLastCalledWith('v9999')
  fireEvent.keyDown(trigger, { key: 'Home' })
  expect(trigger).toHaveAttribute('aria-activedescendant', 'city-options-0')
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
