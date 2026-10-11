import { useRendererClasses, useRendererComponents } from './appearance.js'
import { TungstenLang, useTungstenLang } from '../../../framework/react/src/i18n.js'
import { Temporal } from '@js-temporal/polyfill'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { DateSettings } from '../../../api/src/types.js'

const weekdays = [
  'tg_ui_mon',
  'tg_ui_tue',
  'tg_ui_wed',
  'tg_ui_thu',
  'tg_ui_fri',
  'tg_ui_sat',
  'tg_ui_sun',
]
const months = [
  'tg_ui_january',
  'tg_ui_february',
  'tg_ui_march',
  'tg_ui_april',
  'tg_ui_may',
  'tg_ui_june',
  'tg_ui_july',
  'tg_ui_august',
  'tg_ui_september',
  'tg_ui_october',
  'tg_ui_november',
  'tg_ui_december',
]
const two = (value: number) => String(value).padStart(2, '0')
const validYear = (date: Temporal.PlainDate) => date.year >= 1 && date.year <= 9999

function readDate(value: string, zone: string): Temporal.PlainDate {
  try {
    const date = Temporal.PlainDate.from(value.split('T')[0])
    if (validYear(date)) return date
  } catch {
    /* Empty or invalid entry. */
  }
  return Temporal.Now.plainDateISO(zone)
}
function readTime(value: string): Temporal.PlainTime {
  try {
    return Temporal.PlainTime.from(value.includes('T') ? value.split('T')[1] : value)
  } catch {
    return Temporal.PlainTime.from('00:00')
  }
}

function Calendar({
  initial,
  selected,
  min,
  max,
  onChoose,
}: {
  initial: Temporal.PlainDate
  selected: string
  min?: string
  max?: string
  onChoose: (date: Temporal.PlainDate) => void
}) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t } = useTungstenLang()

  const [focused, setFocused] = useState(initial)
  const gridRef = useRef<HTMLDivElement>(null)
  const month = focused.with({ day: 1 })
  const allowed = (date: Temporal.PlainDate) =>
    validYear(date) && (!min || date.toString() >= min) && (!max || date.toString() <= max)
  const prefix = month.dayOfWeek - 1
  const days = Array.from({ length: month.daysInMonth }, (_, index) => month.add({ days: index }))
  useEffect(() => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
      ?.focus({ preventScroll: true })
  }, [focused])
  function move(date: Temporal.PlainDate) {
    if (!validYear(date)) return
    if (min && date.toString() < min) date = Temporal.PlainDate.from(min)
    if (max && date.toString() > max) date = Temporal.PlainDate.from(max)
    setFocused(date)
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: Temporal.PlainDate) {
    let next: Temporal.PlainDate | undefined
    switch (event.key) {
      case 'ArrowLeft':
        next = date.subtract({ days: 1 })
        break
      case 'ArrowRight':
        next = date.add({ days: 1 })
        break
      case 'ArrowUp':
        next = date.subtract({ days: 7 })
        break
      case 'ArrowDown':
        next = date.add({ days: 7 })
        break
      case 'Home':
        next = date.subtract({ days: date.dayOfWeek - 1 })
        break
      case 'End':
        next = date.add({ days: 7 - date.dayOfWeek })
        break
      case 'PageUp':
        next = date.subtract(event.shiftKey ? { years: 1 } : { months: 1 })
        break
      case 'PageDown':
        next = date.add(event.shiftKey ? { years: 1 } : { months: 1 })
        break
    }
    if (next) {
      event.preventDefault()
      move(next)
    }
  }
  const previous = month.subtract({ months: 1 }),
    next = month.add({ months: 1 })
  return (
    <div className={classes('tg-calendar')}>
      <div className={classes('tg-calendar-heading')}>
        <Button
          className={classes('tg-picker-nav')}
          type="button"
          aria-label={t('tg_ui_previous_month')}
          disabled={
            !validYear(previous) ||
            (!!min && previous.with({ day: previous.daysInMonth }).toString() < min)
          }
          onClick={() => move(focused.subtract({ months: 1 }))}
        >
          <Chevron previous />
        </Button>
        <span aria-live="polite">
          <TungstenLang>{months[month.month - 1]}</TungstenLang> {month.year}
        </span>
        <Button
          className={classes('tg-picker-nav')}
          type="button"
          aria-label={t('tg_ui_next_month')}
          disabled={!validYear(next) || (!!max && next.toString() > max)}
          onClick={() => move(focused.add({ months: 1 }))}
        >
          <Chevron />
        </Button>
      </div>
      <div className={classes('tg-calendar-weekdays')} aria-hidden="true">
        {weekdays.map((day) => (
          <span key={day}>
            <TungstenLang>{day}</TungstenLang>
          </span>
        ))}
      </div>
      <div
        className={classes('tg-calendar-grid')}
        role="grid"
        aria-label={t('tg_ui_calendar_month', {
          month: { messageKey: months[month.month - 1] },
          year: month.year,
        })}
        ref={gridRef}
      >
        {Array.from({ length: Math.ceil((prefix + days.length) / 7) }, (_, row) => (
          <div role="row" key={row}>
            {Array.from({ length: 7 }, (_, column) => {
              const date = days[row * 7 + column - prefix]
              return date ? (
                <div role="gridcell" aria-selected={date.toString() === selected} key={column}>
                  <Button
                    type="button"
                    className={classes('tg-calendar-day')}
                    data-date={date.toString()}
                    data-selected={date.toString() === selected}
                    aria-label={t('tg_ui_calendar_day', {
                      day: date.day,
                      month: { messageKey: months[date.month - 1] },
                      year: date.year,
                    })}
                    disabled={!allowed(date)}
                    tabIndex={date.equals(focused) ? 0 : -1}
                    onKeyDown={(event) => onKeyDown(event, date)}
                    onClick={() => onChoose(date)}
                  >
                    {date.day}
                  </Button>
                </div>
              ) : (
                <div role="gridcell" key={column} />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Chevron({ previous = false }: { previous?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={previous ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
    </svg>
  )
}

function TimeColumn({
  label,
  count,
  value,
  onChoose,
  autoFocus,
}: {
  label: string
  count: number
  value: number
  onChoose: (value: number) => void
  autoFocus?: boolean
}) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t } = useTungstenLang()

  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = ref.current,
      selected = list?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    if (list && selected)
      list.scrollTop = Math.max(
        0,
        selected.offsetTop - (list.clientHeight - selected.clientHeight) / 2,
      )
  }, [value])
  useEffect(() => {
    if (autoFocus)
      ref.current
        ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?.focus({ preventScroll: true })
  }, [autoFocus])
  return (
    <div className={classes('tg-time-column')}>
      <span className={classes('tg-time-heading')}>
        <TungstenLang>{label}</TungstenLang>
      </span>
      <div className={classes('tg-time-list')} role="listbox" aria-label={t(label)} ref={ref}>
        {Array.from({ length: count }, (_, index) => (
          <Button
            type="button"
            role="option"
            className={classes('tg-select-option tg-time-option')}
            key={index}
            aria-label={two(index)}
            aria-selected={index === value}
            tabIndex={index === value ? 0 : -1}
            onClick={() => onChoose(index)}
            onKeyDown={(event) => {
              let next: number | undefined
              if (event.key === 'ArrowDown') next = (index + 1) % count
              if (event.key === 'ArrowUp') next = (index + count - 1) % count
              if (event.key === 'Home') next = 0
              if (event.key === 'End') next = count - 1
              if (next !== undefined) {
                event.preventDefault()
                onChoose(next)
                ref.current
                  ?.querySelector<HTMLButtonElement>(`[aria-label="${two(next)}"]`)
                  ?.focus()
              }
            }}
          >
            <span>{two(index)}</span>
            {index === value ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="m5 12 4 4L19 6" />
              </svg>
            ) : null}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function TungstenDatePicker({
  id,
  value,
  settings,
  min,
  max,
  maxHeight,
  onChange,
  onClose,
}: {
  id: string
  value: string
  settings: DateSettings
  min?: string
  max?: string
  maxHeight: number
  onChange: (value: string) => void
  onClose: () => void
}) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t } = useTungstenLang()

  const mode = settings.mode ?? 'date'
  const zone = mode === 'datetime' ? (settings.timeZone ?? 'UTC') : Temporal.Now.timeZoneId()
  const initial = readDate(value, zone)
  const [selected, setSelected] = useState(
    value.split('T')[0] === initial.toString() ? initial.toString() : '',
  )
  const [time, setTime] = useState(() => readTime(value))
  // Local intent composes rapid menu choices before async core echoes arrive.
  const dateRef = useRef(initial),
    timeRef = useRef(time)
  function chooseDate(date: Temporal.PlainDate) {
    dateRef.current = date
    setSelected(date.toString())
    onChange(mode === 'date' ? date.toString() : date.toPlainDateTime(timeRef.current).toString())
    if (mode === 'date') onClose()
  }
  function chooseTime(next: Temporal.PlainTime) {
    timeRef.current = next
    setTime(next)
    if (mode === 'datetime') setSelected(dateRef.current.toString())
    onChange(mode === 'time' ? next.toString() : dateRef.current.toPlainDateTime(next).toString())
  }
  const today = Temporal.Now.plainDateISO(zone)
  return (
    <div
      className={classes('tg-select-menu tg-date-menu')}
      id={id}
      role="dialog"
      aria-label={t(
        mode === 'time'
          ? 'tg_ui_choose_time'
          : mode === 'date'
            ? 'tg_ui_choose_date'
            : 'tg_ui_choose_date_and_time',
      )}
      data-mode={mode}
      style={{ maxHeight }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className={classes('tg-date-menu-body')}>
        {mode !== 'time' ? (
          <Calendar
            initial={
              min && initial.toString() < min
                ? Temporal.PlainDate.from(min)
                : max && initial.toString() > max
                  ? Temporal.PlainDate.from(max)
                  : initial
            }
            selected={selected}
            min={min}
            max={max}
            onChoose={chooseDate}
          />
        ) : null}
        {mode !== 'date' ? (
          <div className={classes('tg-time-picker')}>
            <TimeColumn
              label="tg_ui_hours"
              count={24}
              value={time.hour}
              autoFocus={mode === 'time'}
              onChoose={(hour) => chooseTime(timeRef.current.with({ hour }))}
            />
            <TimeColumn
              label="tg_ui_minutes"
              count={60}
              value={time.minute}
              onChoose={(minute) => chooseTime(timeRef.current.with({ minute }))}
            />
            <TimeColumn
              label="tg_ui_seconds"
              count={60}
              value={time.second}
              onChoose={(second) => chooseTime(timeRef.current.with({ second }))}
            />
          </div>
        ) : null}
      </div>
      <div className={classes('tg-date-menu-footer')}>
        <Button
          className={classes('tg-picker-action')}
          type="button"
          onClick={() => {
            onChange('')
            onClose()
          }}
        >
          <TungstenLang>tg_ui_clear</TungstenLang>
        </Button>
        <div>
          {mode !== 'time' ? (
            <Button
              className={classes('tg-picker-action')}
              type="button"
              disabled={(!!min && today.toString() < min) || (!!max && today.toString() > max)}
              onClick={() => chooseDate(today)}
            >
              <TungstenLang>tg_ui_today</TungstenLang>
            </Button>
          ) : null}
          <Button
            className={classes('tg-picker-action tg-picker-done')}
            type="button"
            onClick={onClose}
          >
            <TungstenLang>tg_ui_done</TungstenLang>
          </Button>
        </div>
      </div>
    </div>
  )
}
