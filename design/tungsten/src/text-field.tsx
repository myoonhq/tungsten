import { useRendererClasses, useRendererComponents } from './appearance.js'
import { useTungstenLang } from '../../../framework/react/src/i18n.js'
import { useRef, useState, type ChangeEvent } from 'react'
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
  const { Input, Textarea, Button } = useRendererComponents()
  const { t } = useTungstenLang()
  const [draft, setDraft] = useState<string | null>(null)
  const pending = useRef(0)
  const [formatError, setFormatError] = useState(false)
  const errors = formatError ? [...state.errors, 'tg_ui_invalid_json_format'] : state.errors
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
  function update(value: string) {
    setFormatError(false)
    setDraft(value)
    pending.current += 1
    const finish = () => {
      pending.current -= 1
      if (pending.current === 0) setDraft(null)
    }
    try {
      const result = onValueChange(value)
      if (result) void result.then(finish, finish)
      else finish()
    } catch (error) {
      finish()
      throw error
    }
  }
  const json = field.textarea === true && field.view?.format === 'json'
  const props = {
    className: classes(json ? 'tg-input tg-json-input' : 'tg-input'),
    id: inputId,
    name: field.key,
    placeholder: t(field.view?.placeholder),
    value: draft ?? state.value ?? '',
    required,
    disabled: disabled || !!state.loadingSources?.length,
    readOnly,
    'aria-invalid': errors.length > 0,
    'aria-describedby': describedBy(inputId, field.view, errors),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      update(event.target.value),
  }
  return (
    <TungstenFieldShell
      inputId={inputId}
      view={field.view}
      fallbackLabel={field.key}
      required={required}
      errors={errors}
      labelAction={
        json ? (
          <Button
            type="button"
            className={classes('tg-text-action')}
            disabled={disabled || readOnly || !!state.loadingSources?.length}
            onClick={() => {
              let formatted: string
              try {
                formatted = JSON.stringify(JSON.parse(draft ?? String(state.value ?? '')), null, 2)
              } catch {
                setFormatError(true)
                return
              }
              update(formatted)
            }}
          >
            {t('tg_ui_format_json')}
          </Button>
        ) : undefined
      }
      control={{
        kind: 'input',
        disabled: disabled || !!state.loadingSources?.length,
        filled: !!state.value,
      }}
    >
      {field.textarea === true ? (
        <Textarea
          {...props}
          rows={field.rows as number}
          spellCheck={json ? false : undefined}
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
