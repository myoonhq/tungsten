import { useRendererClasses, useRendererComponents } from './appearance.js'
import { useTungstenLang } from '../../../framework/react/src/i18n.js'
import type { ChangeEvent } from 'react'
import type { FieldRendererProps } from '../../../framework/react/src/types.js'
import { describedBy, TungstenFieldShell } from './field-shell.js'

export function TungstenTextField({
  field,
  state,
  inputId,
  required,
  disabled,
  readOnly,
  onValueChange,
}: FieldRendererProps) {
  const classes = useRendererClasses()
  const { Input, Textarea } = useRendererComponents()
  const { t } = useTungstenLang()
  if (state.value !== null && typeof state.value !== 'string') {
    throw new TypeError(
      JSON.stringify({
        messageKey: 'tg_ui_field_expected_a_string_or_null_value',
        params: { p0: field.key },
      }),
    )
  }
  const variant = field.variant ?? 'plain'
  if (field.textarea && variant !== 'plain')
    throw new TypeError(
      JSON.stringify({ messageKey: 'tg_ui_textarea_requires_the_plain_text_variant', params: {} }),
    )
  const props = {
    className: classes('tg-input'),
    id: inputId,
    name: field.key,
    placeholder: t(field.view?.placeholder),
    value: state.value ?? '',
    required,
    disabled: disabled || !!state.loadingSources?.length,
    readOnly,
    'aria-invalid': state.errors.length > 0,
    'aria-describedby': describedBy(inputId, field.view, state.errors),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onValueChange(event.target.value),
  }
  return (
    <TungstenFieldShell
      inputId={inputId}
      view={field.view}
      fallbackLabel={field.key}
      required={required}
      errors={state.errors}
    >
      {field.textarea === true ? (
        <Textarea
          {...props}
          rows={field.rows as number}
          style={{ resize: field.resizable === false ? 'none' : 'vertical' }}
        />
      ) : (
        <Input
          {...props}
          type={variant === 'plain' ? 'text' : (variant as string)}
          autoComplete={
            variant === 'email'
              ? 'email'
              : variant === 'tel'
                ? 'tel'
                : variant === 'password'
                  ? 'current-password'
                  : 'off'
          }
        />
      )}
    </TungstenFieldShell>
  )
}
