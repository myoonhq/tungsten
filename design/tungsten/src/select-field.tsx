import { useRendererClasses, useRendererComponents } from './appearance.js'
import { TungstenLang, useTungstenLang } from '../../../framework/react/src/i18n.js'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { FieldRendererProps } from '../../../framework/react/src/types.js'
import type { SelectOption } from '../../../api/src/types.js'
import { SelectOptions } from './select-options.js'
import { TungstenFieldShell, describedBy } from './field-shell.js'

function Checkmark() {
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
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

export function TungstenSelectField({
  field,
  state,
  inputId,
  required,
  disabled,
  readOnly,
  onValueChange,
}: FieldRendererProps) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t, language } = useTungstenLang()

  const multiple = field.multiple === true
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef({ text: '', time: 0 })
  const pendingRef = useRef<{ values: string[]; count: number } | null>(null)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [menu, setMenu] = useState<{ signature: string; active: number } | null>(null)
  const loading = !!state.loadingSources?.length
  const inactive = disabled || readOnly || loading
  const [wasInactive, setWasInactive] = useState(inactive)
  if (wasInactive !== inactive) {
    setWasInactive(inactive)
    if (inactive) setMenu(null)
  }
  const signature = useMemo(() => JSON.stringify(state.options ?? []), [state.options])
  // Options are cloned by worker responses; only an actual options change closes the menu.
  const open = !!menu && !inactive && menu.signature === signature
  const placeholder = field.view?.placeholder ?? 'tg_ui_select'
  const options = useMemo(() => {
    const loaded = state.options ?? []
    if (loaded.some((option) => typeof option.value !== 'string'))
      throw new TypeError(
        JSON.stringify({ messageKey: 'tg_ui_select_option_values_must_be_strings', params: {} }),
      )
    return [...(multiple ? [] : [{ value: '', label: placeholder }]), ...loaded] as SelectOption[]
  }, [state.options, multiple, placeholder])
  const lookup = useMemo(() => {
    const map = new Map<string, { option: SelectOption; index: number }>()
    options.forEach((option, index) => {
      if (!map.has(option.value)) map.set(option.value, { option, index })
    })
    return map
  }, [options])
  const searchable = useMemo(
    () => options.map((option) => t(option.label).toLocaleLowerCase(language)),
    [options, t, language],
  )
  const values = multiple
    ? (draft ?? (Array.isArray(state.value) ? state.value : []))
    : typeof state.value === 'string'
      ? [state.value]
      : []
  const selectedValues = new Set(values)
  const selectedIndices = values
    .map((value) => lookup.get(value)?.index)
    .filter((index): index is number => index !== undefined)
  const selected = selectedIndices.length ? Math.min(...selectedIndices) : -1
  const active = open ? Math.min(menu!.active, options.length - 1) : -1
  const listId = `${inputId}-options`

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  useEffect(() => {
    if (open && active >= 0)
      document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active, listId])

  if (
    multiple
      ? !Array.isArray(state.value) || state.value.some((value) => typeof value !== 'string')
      : state.value !== null && typeof state.value !== 'string'
  ) {
    throw new TypeError(
      multiple
        ? 'tg_ui_multiple_select_expects_a_string_array'
        : 'tg_ui_select_expects_string_or_null',
    )
  }
  const label =
    selected >= 0
      ? options[selected].label
      : values.length
        ? t('tg_ui_unavailable', { value: values[0] })
        : placeholder
  function show(index = Math.max(selected, 0)) {
    searchRef.current = { text: '', time: 0 }
    setMenu({ signature, active: index })
  }
  function updateMultiple(update: (current: string[]) => string[]) {
    if (inactive) return
    // Compose queued edits against the latest local intent, not a delayed worker echo.
    const current = pendingRef.current?.values ?? values
    const next = update(current)
    const pending = { values: next, count: (pendingRef.current?.count ?? 0) + 1 }
    pendingRef.current = pending
    setDraft(next)
    const finish = () => {
      const latest = pendingRef.current
      if (!latest) return
      latest.count -= 1
      if (latest.count === 0) {
        pendingRef.current = null
        setDraft(null)
      }
    }
    try {
      void Promise.resolve(onValueChange(next)).then(finish, finish)
    } catch (error) {
      finish()
      throw error
    }
  }
  function choose(index: number) {
    const option = options[index]
    if (!option || inactive) return
    if (multiple) {
      updateMultiple((current) =>
        current.includes(option.value)
          ? current.filter((value) => value !== option.value)
          : [...current, option.value],
      )
      triggerRef.current?.focus()
    } else {
      void onValueChange(option.value || null)
      setMenu(null)
    }
    searchRef.current = { text: '', time: 0 }
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (inactive) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!options.length) {
        show()
        return
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const base = open
        ? active
        : selected >= 0
          ? selected
          : multiple
            ? direction === 1
              ? -1
              : 0
            : 0
      show((base + direction + options.length) % options.length)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      show(event.key === 'Home' ? 0 : Math.max(0, options.length - 1))
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setMenu(null)
      }
      searchRef.current = { text: '', time: 0 }
    } else if (event.key === 'Tab') {
      setMenu(null)
      searchRef.current = { text: '', time: 0 }
    } else if (
      event.key === 'Enter' ||
      (event.key === ' ' && !(searchRef.current.text && Date.now() - searchRef.current.time < 700))
    ) {
      event.preventDefault()
      if (open) choose(active)
      else show()
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const now = Date.now()
      const text =
        (now - searchRef.current.time < 700 ? searchRef.current.text : '') +
        event.key.toLocaleLowerCase(language)
      searchRef.current = { text, time: now }
      const prefix = [...text].every((letter) => letter === text[0]) ? text[0] : text
      const start = prefix.length === 1 ? (open ? active : selected) + 1 : 0
      for (let offset = 0; offset < options.length; offset++) {
        const index = (start + offset) % options.length
        if (searchable[index].startsWith(prefix)) {
          setMenu({ signature, active: index })
          break
        }
      }
    }
  }
  const trigger = (
    <Button
      className={classes(multiple ? 'tg-select-multiple-trigger' : 'tg-input tg-select')}
      ref={triggerRef}
      id={inputId}
      name={field.key}
      type="button"
      role="combobox"
      aria-labelledby={`${inputId}-label`}
      disabled={disabled || loading}
      aria-readonly={readOnly || undefined}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={open ? listId : undefined}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      aria-required={required}
      aria-busy={loading}
      aria-invalid={state.errors.length > 0}
      aria-describedby={describedBy(inputId, field.view, state.errors)}
      data-placeholder={!values.length}
      onClick={() => (open ? setMenu(null) : show())}
      onKeyDown={onKeyDown}
    >
      {multiple ? (
        <span className={classes('tg-sr-only')}>
          <TungstenLang>tg_ui_choose_options</TungstenLang>
        </span>
      ) : (
        <span className={classes('tg-select-value')}>
          <TungstenLang>{label}</TungstenLang>
        </span>
      )}
    </Button>
  )

  return (
    <div
      ref={rootRef}
      className={classes('tg-select-field')}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null)
      }}
    >
      <TungstenFieldShell
        inputId={inputId}
        view={field.view}
        fallbackLabel={field.key}
        required={required}
        errors={state.errors}
        control={{ kind: 'select', disabled: disabled || loading, filled: values.some(Boolean) }}
        labelAction={
          multiple && values.length ? (
            <Button
              className={classes('tg-select-clear')}
              type="button"
              disabled={inactive}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                updateMultiple(() => [])
                triggerRef.current?.focus()
              }}
            >
              <TungstenLang>tg_ui_clear_all</TungstenLang>
            </Button>
          ) : undefined
        }
      >
        <div className={classes('tg-select-wrap')}>
          {multiple ? (
            <div
              className={classes('tg-input tg-select tg-select-multiple')}
              data-disabled={inactive}
              data-expanded={open}
              aria-invalid={state.errors.length > 0}
            >
              {trigger}
              <div className={classes('tg-select-chips')}>
                {values.length ? (
                  values.map((value) => {
                    const option = lookup.get(value)?.option
                    const text = option?.label ?? t('tg_ui_unavailable', { value })
                    return (
                      <span
                        className={classes('tg-select-chip')}
                        key={value}
                        data-unavailable={!option}
                      >
                        <span className={classes('tg-select-chip-label')}>
                          <TungstenLang>{text}</TungstenLang>
                        </span>
                        <Button
                          className={classes('tg-select-chip-remove')}
                          type="button"
                          aria-label={t('tg_ui_remove', { label: t(text) })}
                          disabled={inactive}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            updateMultiple((current) => current.filter((entry) => entry !== value))
                            triggerRef.current?.focus()
                          }}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden="true"
                          >
                            <path d="m6 6 12 12M6 18 18 6" />
                          </svg>
                        </Button>
                      </span>
                    )
                  })
                ) : (
                  <span className={classes('tg-select-placeholder')}>
                    <TungstenLang>{placeholder}</TungstenLang>
                  </span>
                )}
              </div>
            </div>
          ) : (
            trigger
          )}
          {loading ? (
            <span
              className={classes('tg-select-indicator')}
              role="status"
              aria-label={t('tg_ui_loading_options')}
            >
              <span className={classes('tg-spinner')} aria-hidden="true" />
            </span>
          ) : (
            <svg
              className={classes('tg-select-arrow')}
              data-open={open}
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
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
          {open ? (
            <SelectOptions
              id={listId}
              label={t(field.view?.label ?? field.key)}
              multiple={multiple}
              count={options.length}
              active={active}
            >
              {(index) => {
                if (index < 0)
                  return (
                    <li className={classes('tg-select-empty')} role="presentation">
                      <TungstenLang>tg_ui_no_options</TungstenLang>
                    </li>
                  )
                const option = options[index]
                return (
                  <li
                    className={classes('tg-select-option')}
                    key={option.value}
                    id={`${listId}-${index}`}
                    role="option"
                    data-option-index={index}
                    aria-setsize={options.length}
                    aria-posinset={index + 1}
                    aria-selected={multiple ? selectedValues.has(option.value) : index === selected}
                    data-active={index === active}
                    data-placeholder={!multiple && index === 0}
                    onPointerMove={() =>
                      setMenu((previous) =>
                        previous?.signature === signature && previous.active === index
                          ? previous
                          : { signature, active: index },
                      )
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(index)}
                  >
                    <span>
                      <TungstenLang>{option.label}</TungstenLang>
                    </span>
                    {(multiple ? selectedValues.has(option.value) : index === selected) ? (
                      <Checkmark />
                    ) : null}
                  </li>
                )
              }}
            </SelectOptions>
          ) : null}
        </div>
      </TungstenFieldShell>
    </div>
  )
}
