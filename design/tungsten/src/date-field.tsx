import { useRendererClasses, useRendererComponents } from './appearance.js'
import { TungstenLang, useTungstenLang } from '../../../framework/react/src/i18n.js'
import { useEffect, useRef, useState } from 'react'
import type { DateSettings } from '../../../api/src/types.js'
import type { FieldRendererProps } from '../../../framework/react/src/types.js'
import { describedBy, TungstenFieldShell } from './field-shell.js'
import {
  dateInputValue,
  dateStorageValue,
  validDateTimeZone,
  dateDisplayValue,
  parseDateEntry,
  dateEntryFormat,
} from '../../../api/src/date.js'
import { TungstenDatePicker } from './date-picker.js'

export function TungstenDateField({
  field,
  state,
  inputId,
  required,
  disabled,
  readOnly,
  onValueChange,
}: FieldRendererProps) {
  const classes = useRendererClasses()
  const { Input, Button } = useRendererComponents()
  const { t, language } = useTungstenLang()

  const [conversionError, setConversionError] = useState<{
    value: string
    message: import('../../../api/src/i18n.js').TungstenText
  } | null>(null)
  const [menu, setMenu] = useState(false)
  const [placement, setPlacement] = useState<'above' | 'below'>('below')
  const [menuHeight, setMenuHeight] = useState(560)
  const rootRef = useRef<HTMLDivElement>(null),
    triggerRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  if (state.value !== null && typeof state.value !== 'string')
    throw new TypeError(
      JSON.stringify({
        messageKey: 'tg_ui_field_expected_a_date_time_string_or_null_value',
        params: { p0: field.key },
      }),
    )
  const currentValue = state.value
  const settings: DateSettings = {
    mode: (field.mode ?? 'date') as DateSettings['mode'],
    timeZone: field.timeZone as string | undefined,
    disambiguation: field.disambiguation as DateSettings['disambiguation'],
  }
  const mode = settings.mode ?? 'date'
  const timeZone = settings.timeZone ?? 'UTC'
  const invalidZone = mode === 'datetime' && !validDateTimeZone(timeZone)
  const inactive = disabled || readOnly || invalidZone
  const [wasInactive, setWasInactive] = useState(inactive)
  if (wasInactive !== inactive) {
    setWasInactive(inactive)
    if (inactive) setMenu(false)
  }
  const open = menu && !inactive
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(false)
    }
    const position = () => {
      const bounds = wrapRef.current?.getBoundingClientRect()
      if (!bounds) return
      const below = window.innerHeight - bounds.bottom - 18,
        above = bounds.top - 18
      const aboveField = below < 300 && above > below
      setPlacement(aboveField ? 'above' : 'below')
      setMenuHeight(Math.max(160, Math.min(560, aboveField ? above : below)))
    }
    position()
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open])
  const localError = invalidZone
    ? {
        messageKey: 'tg_ui_unknown_timezone',
        params: { timeZone },
      }
    : conversionError?.value === state.value
      ? conversionError.message
      : null
  const errors = localError ? [...state.errors, localError] : state.errors
  const limit = (kind: 'min' | 'max') => {
    const value = field.validators?.find((validator) => validator.kind === kind)?.value
    // Datetime bounds are instants: wall-clock bounds can invert during a DST
    // transition. Let core enforce those rather than constrain the HTML input.
    return mode !== 'datetime' && typeof value === 'string' ? value : undefined
  }

  const displayValue = dateDisplayValue(currentValue, settings, language)
  const [entry, setEntry] = useState<{
    language: string
    value: string
    expected: string | null
  } | null>(null)
  const [observedValue, setObservedValue] = useState(currentValue)
  if (observedValue !== currentValue) {
    setObservedValue(currentValue)
    if (entry && entry.expected !== currentValue) setEntry(null)
  }
  const expectedFormat = dateEntryFormat(settings, language)
  const dateErrors = errors.map((error) =>
    typeof error !== 'string' && error.messageKey === 'tg_validation_date'
      ? { ...error, params: { format: expectedFormat } }
      : error,
  )

  function change(input: string, typed = false) {
    if (inactive) return
    try {
      let parsed = input
      try {
        if (typed && input.trim()) parsed = parseDateEntry(input, settings, language)
      } catch {
        setConversionError({
          value: input,
          message: { messageKey: 'tg_validation_date', params: { format: expectedFormat } },
        })
        onValueChange(input)
        return input
      }
      const value = dateStorageValue(parsed, settings, currentValue)
      setConversionError(null)
      onValueChange(value)
      return value
    } catch {
      setConversionError({
        value: input,
        message: { messageKey: 'tg_ui_dst_ambiguous', params: { timeZone } },
      })
      onValueChange(input)
      return input
    }
  }

  function close() {
    setMenu(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={classes('tg-date-field')}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false)
      }}
    >
      <TungstenFieldShell
        inputId={inputId}
        view={field.view}
        fallbackLabel={field.key}
        required={required}
        errors={dateErrors}
        control={{ kind: 'input', disabled: disabled || invalidZone, filled: !!displayValue }}
      >
        <div
          className={classes('tg-select-wrap tg-date-wrap')}
          ref={wrapRef}
          data-expanded={open}
          data-placement={placement}
        >
          <Input
            className={classes('tg-input tg-date-input')}
            lang={language}
            id={inputId}
            name={field.key}
            type="text"
            placeholder={expectedFormat}
            inputMode="text"
            value={entry?.language === language ? entry.value : displayValue}
            min={limit('min')}
            max={limit('max')}
            required={required}
            disabled={disabled || invalidZone}
            readOnly={readOnly}
            aria-invalid={errors.length > 0}
            aria-describedby={
              [
                describedBy(inputId, field.view, errors),
                mode === 'datetime' ? `${inputId}-timezone` : null,
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
            onFocus={() => setEntry({ language, value: displayValue, expected: currentValue })}
            onBlur={() => setEntry(null)}
            onChange={(event) => {
              const value = event.target.value
              const expected = change(value, true)
              setEntry({ language, value, expected: expected ?? currentValue })
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && event.altKey && !inactive) {
                event.preventDefault()
                setMenu(true)
              } else if (event.key === 'Escape' && open) {
                event.preventDefault()
                close()
              }
            }}
          />
          {displayValue ? (
            <span
              className={classes('tg-date-display')}
              aria-hidden="true"
              style={{ display: 'none' }}
            >
              {displayValue}
            </span>
          ) : null}
          <Button
            type="button"
            className={classes('tg-date-trigger')}
            ref={triggerRef}
            disabled={inactive}
            aria-label={t('tg_ui_choose_for', {
              mode: { messageKey: `tg_ui_mode_${mode}` },
              label: { messageKey: field.view?.label ?? field.key },
            })}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? `${inputId}-picker` : undefined}
            onClick={() => setMenu(!open)}
          >
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
              {mode === 'time' ? (
                <>
                  <circle cx="12" cy="12" r="8" />
                  <path d="M12 7v5l3 2" />
                </>
              ) : (
                <>
                  <rect x="4" y="6" width="16" height="15" rx="2" />
                  <path d="M8 3v6m8-6v6M4 11h16" />
                </>
              )}
            </svg>
          </Button>
          {open ? (
            <TungstenDatePicker
              id={`${inputId}-picker`}
              maxHeight={menuHeight}
              value={dateInputValue(currentValue, settings)}
              settings={settings}
              min={limit('min')}
              max={limit('max')}
              onChange={(value) => {
                setEntry(null)
                change(value)
              }}
              onClose={close}
            />
          ) : null}
        </div>
        {mode === 'datetime' ? (
          <span className={classes('tg-description')} id={`${inputId}-timezone`}>
            <TungstenLang params={{ timeZone }}>tg_ui_timezone</TungstenLang>
          </span>
        ) : null}
      </TungstenFieldShell>
    </div>
  )
}
