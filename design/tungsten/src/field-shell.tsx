import { useRendererClasses } from './appearance.js'
import { TungstenLang } from '../../../framework/react/src/i18n.js'
import type { TungstenText } from '../../../api/src/i18n.js'
import type { PropsWithChildren, ReactNode } from 'react'
import type { FieldView } from '../../../api/src/types.js'

type TungstenFieldShellProps = PropsWithChildren<{
  inputId: string
  view: FieldView | undefined
  fallbackLabel: string
  required: boolean
  errors: readonly TungstenText[]
  checkbox?: boolean
  labelAction?: ReactNode
}>

export function TungstenFieldShell({
  inputId,
  view,
  fallbackLabel,
  required,
  errors,
  checkbox = false,
  labelAction,
  children,
}: TungstenFieldShellProps) {
  const classes = useRendererClasses()
  const descriptionId = view?.description ? `${inputId}-description` : undefined
  const errorId = errors.length > 0 ? `${inputId}-errors` : undefined

  return (
    <div
      className={classes(
        [
          'tg-field',
          checkbox ? 'tg-field--checkbox' : '',
          errors.length > 0 ? 'tg-field--invalid' : '',
        ]
          .filter(Boolean)
          .join(' '),
      )}
    >
      {checkbox ? (
        <div className={classes('tg-checkbox-row')}>
          {children}
          <label className={classes('tg-checkbox-label')} htmlFor={inputId}>
            <TungstenLang>{view?.label ?? fallbackLabel}</TungstenLang>
            {required ? (
              <span className={classes('tg-required')} aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
        </div>
      ) : (
        <>
          <div className={classes('tg-label-row')}>
            <label className={classes('tg-label')} id={`${inputId}-label`} htmlFor={inputId}>
              <TungstenLang>{view?.label ?? fallbackLabel}</TungstenLang>
              {required ? (
                <span className={classes('tg-required')} aria-hidden="true">
                  *
                </span>
              ) : null}
            </label>
            {labelAction}
          </div>
          {children}
        </>
      )}

      {view?.description ? (
        <p className={classes('tg-description')} id={descriptionId}>
          <TungstenLang>{view.description}</TungstenLang>
        </p>
      ) : null}

      {errors.length > 0 ? (
        <ul className={classes('tg-errors')} id={errorId} aria-live="polite">
          {errors.map((error, index) => (
            <li key={`${inputId}-error-${index}`}>
              <TungstenLang>{error}</TungstenLang>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function describedBy(
  inputId: string,
  view: FieldView | undefined,
  errors: readonly TungstenText[],
): string | undefined {
  const ids = [
    view?.description ? `${inputId}-description` : null,
    errors.length > 0 ? `${inputId}-errors` : null,
  ].filter((id): id is string => id !== null)

  return ids.length > 0 ? ids.join(' ') : undefined
}
