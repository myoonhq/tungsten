import { useRendererClasses, useRendererComponents } from './appearance.js'
import { TungstenLang } from '../../../framework/react/src/i18n.js'
import type { BooleanOption } from '../../../api/src/types.js'
import type { FieldRendererProps } from '../../../framework/react/src/types.js'
import { describedBy, TungstenFieldShell } from './field-shell.js'

const defaultOptions: BooleanOption[] = [
  { value: true, label: 'tg_ui_yes' },
  { value: false, label: 'tg_ui_no' },
]

export function TungstenBooleanField({
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
  if (state.value !== null && typeof state.value !== 'boolean') {
    throw new TypeError(
      JSON.stringify({
        messageKey: 'tg_ui_field_expected_a_boolean_or_null_value',
        params: { p0: field.key },
      }),
    )
  }
  const variant = field.variant ?? 'checkbox'
  const inactive = disabled || !!state.loadingSources?.length
  const description = describedBy(inputId, field.view, state.errors)
  if (variant === 'radio') {
    const options =
      state.options ??
      (field.options as BooleanOption[] | undefined) ??
      (field.bindings?.options ? [] : defaultOptions)
    if (options.some((option) => typeof option.value !== 'boolean'))
      throw new TypeError(
        JSON.stringify({
          messageKey: 'tg_ui_boolean_radio_options_must_use_boolean_values',
          params: {},
        }),
      )
    const hasSelection = options.some((option) => option.value === state.value)
    return (
      <TungstenFieldShell
        inputId={inputId}
        view={field.view}
        fallbackLabel={field.key}
        required={required}
        errors={state.errors}
        labelAction={
          state.value !== null ? (
            <Button
              type="button"
              className={classes('tg-select-clear')}
              disabled={inactive || readOnly}
              onClick={() => onValueChange(null)}
            >
              <TungstenLang>tg_ui_clear</TungstenLang>
            </Button>
          ) : undefined
        }
      >
        <div
          id={inputId}
          tabIndex={!inactive ? -1 : undefined}
          onFocus={(event) => {
            if (event.target === event.currentTarget)
              event.currentTarget
                .querySelector<HTMLInputElement>('input[tabindex="0"]:not(:disabled)')
                ?.focus()
          }}
          className={classes('tg-radio-group')}
          data-direction={field.direction ?? 'column'}
          role="radiogroup"
          aria-labelledby={`${inputId}-label`}
          aria-describedby={description}
          aria-required={required}
          aria-readonly={readOnly || undefined}
          aria-invalid={state.errors.length > 0}
          aria-busy={!!state.loadingSources?.length}
        >
          {options.map((option, index) => (
            <label
              className={classes('tg-radio-option')}
              key={String(option.value)}
              data-disabled={inactive || readOnly}
            >
              <Input
                className={classes('tg-radio')}
                type="radio"
                name={inputId}
                value={String(option.value)}
                checked={state.value === option.value}
                disabled={inactive}
                aria-readonly={readOnly || undefined}
                aria-invalid={state.errors.length > 0}
                aria-describedby={description}
                tabIndex={state.value === option.value || (!hasSelection && index === 0) ? 0 : -1}
                onClick={(event) => {
                  if (readOnly) event.preventDefault()
                }}
                onChange={() => {
                  if (!readOnly && !inactive) onValueChange(option.value)
                }}
                onKeyDown={(event) => {
                  if (readOnly || inactive) {
                    if (
                      [' ', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)
                    )
                      event.preventDefault()
                    return
                  }
                  const step = ['ArrowRight', 'ArrowDown'].includes(event.key)
                    ? 1
                    : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                      ? -1
                      : 0
                  if (!step) return
                  event.preventDefault()
                  const next = (index + step + options.length) % options.length
                  const inputs = event.currentTarget
                    .closest('[role="radiogroup"]')
                    ?.querySelectorAll<HTMLInputElement>('input')
                  inputs?.[next]?.focus()
                  onValueChange(options[next].value)
                }}
              />
              <span>
                <TungstenLang>{option.label}</TungstenLang>
              </span>
            </label>
          ))}
          {!options.length && !state.loadingSources?.length ? (
            <span className={classes('tg-description')}>
              <TungstenLang>tg_ui_no_options</TungstenLang>
            </span>
          ) : null}
        </div>
      </TungstenFieldShell>
    )
  }
  return (
    <TungstenFieldShell
      inputId={inputId}
      view={field.view}
      fallbackLabel={field.key}
      required={required}
      errors={state.errors}
      checkbox
    >
      <Input
        className={classes(variant === 'switch' ? 'tg-switch' : 'tg-checkbox')}
        id={inputId}
        name={field.key}
        type="checkbox"
        role={variant === 'switch' ? 'switch' : undefined}
        checked={state.value ?? false}
        aria-required={required}
        disabled={inactive}
        aria-readonly={readOnly || undefined}
        aria-invalid={state.errors.length > 0}
        aria-describedby={description}
        onChange={(event) => {
          if (!readOnly) onValueChange(event.target.checked)
        }}
      />
    </TungstenFieldShell>
  )
}
