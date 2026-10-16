import { createContext, useContext, useState, type ReactNode } from 'react'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import type { FieldControlProps } from '../../tungsten/src/appearance.js'
import { useTungstenLang } from '../../../framework/react/src/i18n.js'

const LabelContext = createContext<ReactNode>(undefined)
export const useMaterialLabel = () => useContext(LabelContext)

/** Share MUI's label/input contract without replacing Tungsten's select interactions. */
export function MaterialFieldControl({
  inputId,
  label: labelKey,
  required,
  invalid,
  kind,
  disabled,
  filled,
  children,
  labelAction,
}: FieldControlProps) {
  const [focused, setFocused] = useState(false)
  const { t } = useTungstenLang()
  const label = t(labelKey)
  const shrink = !label || filled || focused
  const outlineLabel = (
    <>
      {label}
      {required ? ' *' : ''}
    </>
  )
  return (
    <LabelContext.Provider value={label}>
      <FormControl
        fullWidth
        variant="outlined"
        size="small"
        required={required}
        disabled={disabled}
        error={invalid}
        focused={focused}
        className={kind === 'select' ? 'tm-floating-select' : 'tm-floating-input'}
        data-shrink={shrink}
        data-has-label={!!label}
        data-clearable={!!labelAction}
        data-focused={focused}
        data-invalid={invalid}
        data-disabled={disabled}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
        }}
      >
        <InputLabel
          id={`${inputId}-label`}
          htmlFor={inputId}
          shrink={kind === 'select' || !label ? shrink : undefined}
          required={required && !!label}
        >
          {label}
        </InputLabel>
        {children}
        {labelAction ? <span className="tm-select-clear-action">{labelAction}</span> : null}
        {kind === 'select' ? (
          <fieldset className="tm-select-outline" aria-hidden="true">
            <legend>
              <span>{outlineLabel}</span>
            </legend>
          </fieldset>
        ) : null}
      </FormControl>
    </LabelContext.Provider>
  )
}
