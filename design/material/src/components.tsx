import { forwardRef, type ComponentPropsWithRef } from 'react'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import OutlinedInput from '@mui/material/OutlinedInput'
import Radio from '@mui/material/Radio'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import { useMaterialLabel } from './field-control.js'

// Forward native refs and events: shared keyboard and focus logic addresses the input/button.
export const MaterialInput = forwardRef<HTMLInputElement, ComponentPropsWithRef<'input'>>(
  function MaterialInput({ type = 'text', ...props }, ref) {
    const label = useMaterialLabel()
    if (type === 'checkbox' || type === 'radio') {
      const Control = type === 'radio' ? Radio : props.role === 'switch' ? Switch : Checkbox
      const { checked, disabled, onChange, name, value, ...inputProps } = props
      return (
        <Control
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          name={name}
          value={value}
          size="small"
          slotProps={{ input: { ...inputProps, ref } }}
        />
      )
    }
    const { value, defaultValue, onChange, disabled, readOnly, required, ...inputProps } = props
    return (
      <OutlinedInput
        label={label}
        fullWidth
        size="small"
        type={type}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        error={props['aria-invalid'] === true || props['aria-invalid'] === 'true'}
        inputRef={ref}
        inputProps={inputProps}
      />
    )
  },
)

export const MaterialTextarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithRef<'textarea'>>(
  function MaterialTextarea(
    { value, defaultValue, onChange, disabled, readOnly, required, rows, ...inputProps },
    ref,
  ) {
    const label = useMaterialLabel()
    return (
      <OutlinedInput
        label={label}
        size="small"
        fullWidth
        multiline
        inputComponent="textarea"
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        error={inputProps['aria-invalid'] === true || inputProps['aria-invalid'] === 'true'}
        inputRef={ref}
        inputProps={inputProps}
      />
    )
  },
)

export const MaterialButton = forwardRef<HTMLButtonElement, ComponentPropsWithRef<'button'>>(
  function MaterialButton({ className = '', children, ...props }, ref) {
    if (/\btg-select-clear\b/.test(className))
      return (
        <IconButton
          {...props}
          ref={ref}
          className={className}
          size="small"
          color="primary"
          disableRipple
        >
          <span className="tg-sr-only">{children}</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </IconButton>
      )
    const primary = /\btg-(submit|picker-done)\b/.test(className)
    const outlined = /\btg-(button|group-trigger|picker-action|file-retry|select)\b/.test(className)
    return (
      <Button
        {...props}
        component="button"
        color="primary"
        ref={ref}
        className={className}
        variant={primary ? 'contained' : outlined ? 'outlined' : 'text'}
        size="small"
        disableRipple
        sx={{ minWidth: 0, textTransform: 'none', font: 'inherit', letterSpacing: 'inherit' }}
      >
        {children}
      </Button>
    )
  },
)
