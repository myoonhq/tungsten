import {
  RendererAppearanceProvider,
  useRendererAppearance,
  useRendererClasses,
  useRendererComponents,
} from './appearance.js'
import { TungstenLang, useTungstenLang } from '../../../framework/react/src/i18n.js'
import {
  useTungstenColorScheme,
  useTungstenColorProfile,
} from '../../../framework/react/src/theme.js'
import type { DesignFormProps, DesignMessageProps } from '../../../framework/react/src/types.js'

export function SharedForm({
  submitLabel = 'tg_ui_submit',
  children,
  onSubmit,
  submitting,
  busy = false,
  error,
  saveStatus = 'idle',
  submitStatus = 'idle',
}: DesignFormProps) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { language } = useTungstenLang()
  const colorScheme = useTungstenColorScheme()
  const colorProfile = useTungstenColorProfile()
  const { colorSchemeAttribute, rootStyle } = useRendererAppearance()
  return (
    <form
      lang={language}
      className={classes('tg-root tg-form')}
      data-tg-color-scheme={colorScheme}
      data-tg-color-profile={colorProfile}
      style={rootStyle}
      {...(colorSchemeAttribute ? { [colorSchemeAttribute]: colorScheme } : {})}
      noValidate
      onSubmit={onSubmit}
    >
      <div className={classes('tg-fields')}>{children}</div>

      {error ? (
        <div className={classes('tg-form-error')} role="alert">
          <TungstenLang>{error}</TungstenLang>
        </div>
      ) : null}

      {saveStatus !== 'idle' ? (
        <p
          className={classes('tg-operation-status')}
          role={saveStatus === 'error' ? 'alert' : 'status'}
        >
          <TungstenLang>{`tg_ui_save_${saveStatus}`}</TungstenLang>
        </p>
      ) : null}
      {submitStatus !== 'idle' ? (
        <p
          className={classes('tg-operation-status')}
          role={submitStatus === 'error' ? 'alert' : 'status'}
        >
          <TungstenLang>{`tg_ui_submit_${submitStatus}`}</TungstenLang>
        </p>
      ) : null}
      <div className={classes('tg-actions')}>
        <Button className={classes('tg-submit')} type="submit" disabled={submitting || busy}>
          {submitting || busy ? (
            <>
              <span className={classes('tg-spinner')} aria-hidden="true" />
              <TungstenLang>{submitting ? 'tg_ui_submitting' : 'tg_ui_updating'}</TungstenLang>
            </>
          ) : (
            <TungstenLang>{submitLabel}</TungstenLang>
          )}
        </Button>
      </div>
    </form>
  )
}

export function SharedLoading({ message = 'tg_ui_preparing_form' }: DesignMessageProps) {
  const classes = useRendererClasses()
  const { language } = useTungstenLang()
  const colorScheme = useTungstenColorScheme()
  const colorProfile = useTungstenColorProfile()
  const { colorSchemeAttribute, rootStyle } = useRendererAppearance()
  return (
    <div
      lang={language}
      className={classes('tg-root tg-message')}
      data-tg-color-scheme={colorScheme}
      data-tg-color-profile={colorProfile}
      style={rootStyle}
      {...(colorSchemeAttribute ? { [colorSchemeAttribute]: colorScheme } : {})}
      role="status"
    >
      <span className={classes('tg-spinner')} aria-hidden="true" />
      <TungstenLang>{message}</TungstenLang>
    </div>
  )
}

export function SharedFailure({ message = 'tg_ui_load_failed' }: DesignMessageProps) {
  const classes = useRendererClasses()
  const { language } = useTungstenLang()
  const colorScheme = useTungstenColorScheme()
  const colorProfile = useTungstenColorProfile()
  const { colorSchemeAttribute, rootStyle } = useRendererAppearance()
  return (
    <div
      lang={language}
      className={classes('tg-root tg-failure')}
      data-tg-color-scheme={colorScheme}
      data-tg-color-profile={colorProfile}
      style={rootStyle}
      {...(colorSchemeAttribute ? { [colorSchemeAttribute]: colorScheme } : {})}
      role="alert"
    >
      <span className={classes('tg-failure-mark')} aria-hidden="true">
        !
      </span>
      <div>
        <strong>
          <TungstenLang>tg_ui_something_went_wrong</TungstenLang>
        </strong>
        <p>
          <TungstenLang>{message}</TungstenLang>
        </p>
      </div>
    </div>
  )
}

// Each built-in root declares its presentation independently.
const tungstenAppearance = { classes: {} }
export function TungstenForm(props: DesignFormProps) {
  return (
    <RendererAppearanceProvider appearance={tungstenAppearance}>
      <SharedForm {...props} />
    </RendererAppearanceProvider>
  )
}
export function TungstenLoading(props: DesignMessageProps) {
  return (
    <RendererAppearanceProvider appearance={tungstenAppearance}>
      <SharedLoading {...props} />
    </RendererAppearanceProvider>
  )
}
export function TungstenFailure(props: DesignMessageProps) {
  return (
    <RendererAppearanceProvider appearance={tungstenAppearance}>
      <SharedFailure {...props} />
    </RendererAppearanceProvider>
  )
}
