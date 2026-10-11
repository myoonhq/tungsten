import { TungstenLang } from '../i18n.js'
import { useTungstenColorScheme } from '../theme.js'
import tungsten, {
  TungstenTextField,
  TungstenFieldset,
} from '../../../../design/tungsten/src/index.js'
import { TungstenFieldShell, describedBy } from '../../../../design/tungsten/src/field-shell.js'
import type { DesignFormProps, FieldRendererProps, TungstenDesign } from '../types.js'

function EditorText(props: FieldRendererProps) {
  const { field, state, inputId, disabled, required, onValueChange } = props
  const control = field.view?.editorControl
  if (control !== 'select' && control !== 'textarea' && control !== 'json')
    return <TungstenTextField {...props} />
  const common = {
    id: inputId,
    name: field.key,
    disabled,
    required,
    'aria-invalid': state.errors.length > 0,
    'aria-describedby': describedBy(inputId, field.view, state.errors),
    value: String(state.value ?? ''),
    onChange: (event: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>) =>
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
      {control === 'select' ? (
        <select className="tg-input" {...common}>
          <option value="">
            <TungstenLang>tg_editor_choose</TungstenLang>
          </option>
          {(
            (field.view?.options as readonly (string | { value: string; label: string })[]) ?? []
          ).map((option) => {
            const value = typeof option === 'string' ? option : option.value
            return (
              <option key={value} value={value}>
                <TungstenLang>{typeof option === 'string' ? option : option.label}</TungstenLang>
              </option>
            )
          })}
        </select>
      ) : (
        <textarea
          className={`tg-input ${control === 'json' ? 'te-code-input' : ''}`}
          rows={control === 'json' ? 3 : 2}
          spellCheck={false}
          {...common}
        />
      )}
    </TungstenFieldShell>
  )
}
function EditorForm({ children, onSubmit, submitting, busy, error }: DesignFormProps) {
  const colorScheme = useTungstenColorScheme()
  return (
    <form
      className="tg-root tg-form te-settings-form"
      data-tg-color-scheme={colorScheme}
      noValidate
      onSubmit={onSubmit}
    >
      <div className="tg-fields">{children}</div>
      {error ? (
        <p className="te-error" role="alert">
          <TungstenLang>{error}</TungstenLang>
        </p>
      ) : null}
      <button type="submit" className="tg-submit" disabled={submitting || busy}>
        <TungstenLang>
          {submitting ? 'tg_editor_applying' : busy ? 'tg_ui_updating' : 'tg_editor_apply_changes'}
        </TungstenLang>
      </button>
    </form>
  )
}
export const editorDesign: TungstenDesign = {
  ...tungsten,
  name: 'tungsten-editor',
  Form: EditorForm,
  fields: { ...tungsten.fields, text: EditorText },
  groups: { ...tungsten.groups, fieldset: { variant: 'basic', Renderer: TungstenFieldset } },
}
