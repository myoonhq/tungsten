import { useRendererClasses, useRendererComponents } from './appearance.js'
import { useTungstenLang } from '../../../framework/react/src/i18n.js'
import type { FieldRendererProps } from '../../../framework/react/src/types.js'
import { describedBy, TungstenFieldShell } from './field-shell.js'

export function TungstenNumberField({
  field,
  state,
  inputId,
  required,
  disabled,
  readOnly,
  onValueChange,
}: FieldRendererProps) {
  const classes = useRendererClasses()
  const { Input } = useRendererComponents()
  const { t } = useTungstenLang()

  if (state.value !== null && typeof state.value !== 'number') {
    throw new TypeError(
      JSON.stringify({
        messageKey: 'tg_ui_field_expected_a_number_or_null_value',
        params: { p0: field.key },
      }),
    )
  }

  return (
    <TungstenFieldShell
      inputId={inputId}
      view={field.view}
      fallbackLabel={field.key}
      required={required}
      errors={state.errors}
      control={{ kind: 'input', disabled, filled: state.value !== null }}
    >
      <Input
        className={classes('tg-input')}
        id={inputId}
        name={field.key}
        type="number"
        step="any"
        autoComplete="off"
        placeholder={t(field.view?.placeholder)}
        value={state.value ?? ''}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={state.errors.length > 0}
        aria-describedby={describedBy(inputId, field.view, state.errors)}
        onChange={(event) => {
          const rawValue = event.target.value
          onValueChange(rawValue === '' ? null : event.target.valueAsNumber)
        }}
      />
    </TungstenFieldShell>
  )
}
