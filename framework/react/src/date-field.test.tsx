import { dateDisplayValue } from '../../../api/src/date.js'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TungstenDateField } from '../../../design/tungsten/src/date-field.js'
import { TungstenLanguageProvider } from './i18n.js'
import { waitFor } from '@testing-library/react'
import type { FieldRendererProps } from './types.js'

function props(overrides: Partial<FieldRendererProps> = {}): FieldRendererProps {
  return {
    field: { type: 'date', key: 'date', view: { label: 'Date', description: 'Choose a date.' } },
    state: { value: null, hidden: false, errors: [] },
    inputId: 'date',
    required: false,
    disabled: false,
    readOnly: false,
    onValueChange: vi.fn(),
    ...overrides,
  }
}

describe('date/time renderer', () => {
  it('changes the displayed ordering with language while retaining values and timezone', async () => {
    const p = props({
      field: {
        type: 'date',
        key: 'date',
        mode: 'datetime',
        timeZone: 'Europe/Bratislava',
        view: { label: 'Meeting' },
      },
      state: { value: '2026-10-07T07:30:00.123Z', hidden: false, errors: [] },
    })
    const { container, rerender } = render(
      <TungstenLanguageProvider language="en">
        <TungstenDateField {...p} />
      </TungstenLanguageProvider>,
    )
    const display = () => container.querySelector('.tg-date-display')?.textContent
    await waitFor(() => expect(display()).toContain('10/07/2026'))
    expect(display()).toContain('09:30:00.123')
    for (const language of ['sk', 'hu']) {
      rerender(
        <TungstenLanguageProvider language={language}>
          <TungstenDateField {...p} />
        </TungstenLanguageProvider>,
      )
      const expected = new Intl.DateTimeFormat(language, {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      }).format(new Date('2026-10-07T09:30:00.123Z'))
      await waitFor(() => expect(display()).toBe(expected))
      expect(screen.getByLabelText('Meeting')).toHaveValue(expected)
    }
    expect(p.onValueChange).not.toHaveBeenCalled()
  })
  it('formats a date-only value without a host timezone shift and a time without a date', async () => {
    const p = props({ state: { value: '2026-10-07', hidden: false, errors: [] } })
    const { container, rerender } = render(
      <TungstenLanguageProvider language="hu">
        <TungstenDateField {...p} />
      </TungstenLanguageProvider>,
    )
    await waitFor(() =>
      expect(container.querySelector('.tg-date-display')).toHaveTextContent('2026. 10. 07.'),
    )
    rerender(
      <TungstenLanguageProvider language="sk">
        <TungstenDateField
          {...p}
          field={{ ...p.field, mode: 'time' }}
          state={{
            ...p.state,
            value: '09:30',
          }}
        />
      </TungstenLanguageProvider>,
    )
    await waitFor(() =>
      expect(container.querySelector('.tg-date-display')).toHaveTextContent('09:30'),
    )
    expect(container.querySelector('.tg-date-display')).not.toHaveTextContent('2026')
  })
  it('keeps millisecond values visible in localized time and datetime inputs', () => {
    const p = props({
      field: { type: 'date', key: 'date', mode: 'time', view: { label: 'Time' } },
      state: { value: '09:30:00.123', hidden: false, errors: [] },
    })
    const view = render(<TungstenDateField {...p} />)
    expect(screen.getByLabelText('Time')).toHaveValue(
      dateDisplayValue('09:30:00.123', { mode: 'time' }, 'en'),
    )
    view.rerender(
      <TungstenDateField
        {...p}
        field={{ ...p.field, mode: 'datetime', timeZone: 'UTC' }}
        state={{ ...p.state, value: '2026-10-07T09:30:00.123Z' }}
      />,
    )
    expect(screen.getByLabelText('Time')).toHaveValue(
      dateDisplayValue('2026-10-07T09:30:00.123Z', { mode: 'datetime' }, 'en'),
    )
  })
  it('uses locale entry with picker bounds and clears to null', () => {
    const p = props({
      field: {
        type: 'date',
        key: 'date',
        view: { label: 'Date' },
        validators: [
          { kind: 'min', value: '2026-01-01' },
          { kind: 'max', value: '2026-12-31' },
        ],
      },
      required: true,
    })
    const view = render(<TungstenDateField {...p} />)
    const input = screen.getByLabelText(/^Date/)
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('min', '2026-01-01')
    expect(input).toHaveAttribute('max', '2026-12-31')
    expect(input).toBeRequired()
    fireEvent.change(input, { target: { value: '2026-10-07' } })
    expect(p.onValueChange).toHaveBeenLastCalledWith('2026-10-07')
    view.rerender(
      <TungstenDateField {...p} state={{ value: '2026-10-07', hidden: false, errors: [] }} />,
    )
    fireEvent.change(input, { target: { value: '' } })
    expect(p.onValueChange).toHaveBeenLastCalledWith(null)
  })

  it('renders time-only values, read-only/disabled state, and accessible errors', () => {
    const p = props({
      field: {
        type: 'date',
        mode: 'time',
        key: 'date',
        view: { label: 'Time', description: 'Opening time' },
      },
      state: { value: '09:30:00', hidden: false, errors: ['Must be after 10:00.'] },
      readOnly: true,
      disabled: true,
    })
    render(<TungstenDateField {...p} />)
    const input = screen.getByLabelText('Time')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue(dateDisplayValue('09:30:00', { mode: 'time' }, 'en'))
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'date-description date-errors')
  })

  it('displays in the configured timezone, converts edits to UTC, and rejects DST gaps', () => {
    const p = props({
      field: {
        type: 'date',
        mode: 'datetime',
        timeZone: 'Europe/Bratislava',
        key: 'date',
        view: { label: 'Meeting' },
      },
      state: { value: '2026-10-07T07:30:00Z', hidden: false, errors: [] },
    })
    const view = render(<TungstenDateField {...p} />)
    const input = screen.getByLabelText('Meeting')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue(
      dateDisplayValue(
        '2026-10-07T07:30:00Z',
        { mode: 'datetime', timeZone: 'Europe/Bratislava' },
        'en',
      ),
    )
    expect(screen.getByText('Timezone: Europe/Bratislava')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '2026-10-07T10:30' } })
    expect(p.onValueChange).toHaveBeenLastCalledWith('2026-10-07T08:30:00Z')
    fireEvent.change(input, { target: { value: '2026-03-29T02:30' } })
    expect(p.onValueChange).toHaveBeenLastCalledWith('2026-03-29T02:30')
    view.rerender(
      <TungstenDateField
        {...p}
        state={{
          value: '2026-03-29T02:30',
          hidden: false,
          errors: ['Enter a valid date and time.'],
        }}
      />,
    )
    expect(input).toHaveValue('2026-03-29T02:30')
    expect(screen.getByText(/This time is skipped or repeated/)).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('navigates the calendar across leap days, respects bounds and restores focus on selection', () => {
    const p = props({
      field: {
        type: 'date',
        key: 'date',
        view: { label: 'Date' },
        validators: [
          { kind: 'min', value: '2024-02-01' },
          { kind: 'max', value: '2024-03-15' },
        ],
      },
      state: { value: '2024-02-29', hidden: false, errors: [] },
    })
    render(<TungstenDateField {...p} />)
    const trigger = screen.getByRole('button', { name: 'Choose date for Date' })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Choose date' })).toBeInTheDocument()
    const leap = screen.getByRole('button', { name: '29 February 2024' })
    expect(leap).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    fireEvent.keyDown(leap, { key: 'ArrowRight' })
    const march = screen.getByRole('button', { name: '1 March 2024' })
    expect(march).toHaveFocus()
    expect(screen.getByRole('button', { name: '16 March 2024' })).toBeDisabled()
    fireEvent.click(march)
    expect(p.onValueChange).toHaveBeenLastCalledWith('2024-03-01')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('composes rapid time choices, preserves milliseconds, and clears through the menu', () => {
    const p = props({
      field: { type: 'date', key: 'date', mode: 'time', view: { label: 'Time' } },
      state: { value: '09:30:10.123', hidden: false, errors: [] },
    })
    render(<TungstenDateField {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose time for Time' }))
    const hours = within(screen.getByRole('listbox', { name: 'Hours' }))
    fireEvent.click(hours.getByRole('option', { name: '10' }))
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Minutes' })).getByRole('option', { name: '45' }),
    )
    expect(p.onValueChange).toHaveBeenLastCalledWith('10:45:10.123')
    fireEvent.keyDown(hours.getByRole('option', { name: '10' }), { key: 'ArrowDown' })
    expect(p.onValueChange).toHaveBeenLastCalledWith('11:45:10.123')
    fireEvent.click(screen.getByRole('button', { name: 'Clear', exact: true }))
    expect(p.onValueChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('converts combined picker choices to UTC and closes with Escape or an outside pointer', () => {
    const p = props({
      field: {
        type: 'date',
        key: 'date',
        mode: 'datetime',
        timeZone: 'Europe/Bratislava',
        view: { label: 'Meeting' },
      },
      state: { value: '2026-10-07T07:30:00Z', hidden: false, errors: [] },
    })
    render(<TungstenDateField {...p} />)
    const trigger = screen.getByRole('button', { name: 'Choose date and time for Meeting' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '8 October 2026' }))
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Hours' })).getByRole('option', { name: '10' }),
    )
    expect(p.onValueChange).toHaveBeenLastCalledWith('2026-10-08T08:30:00Z')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes when loading disables the field and prevents read-only selection', () => {
    const p = props()
    const view = render(<TungstenDateField {...p} />)
    const trigger = screen.getByRole('button', { name: 'Choose date for Date' })
    fireEvent.click(trigger)
    view.rerender(<TungstenDateField {...p} disabled />)
    expect(trigger).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<TungstenDateField {...p} readOnly />)
    expect(trigger).toBeDisabled()
  })
})
