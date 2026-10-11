import { useRendererClasses } from './appearance.js'
import { TungstenLang } from '../../../framework/react/src/i18n.js'
import type {
  GroupDisclosureSettings,
  GroupRendererProps,
} from '../../../framework/react/src/types.js'
import { containsField, groupSpacing, settingsOf, useGroupPresentation } from './group-shared.js'

function Disclosure(props: GroupRendererProps & { kind: string }) {
  const classes = useRendererClasses()
  const { group, groupId, children, disabled, errorCount, kind } = props
  const settings = settingsOf<GroupDisclosureSettings>(group)
  const [open, setOpen] = useGroupPresentation(
    settings.initiallyOpen ?? false,
    props,
    (fieldKey) => (containsField(group, fieldKey) ? true : undefined),
  )
  return (
    <details
      className={classes(`tg-group tg-group--disclosure tg-group--${kind}`)}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        id={`${groupId}-title`}
        onClick={(event) => {
          if (disabled) event.preventDefault()
        }}
        aria-disabled={disabled || undefined}
      >
        <TungstenLang>{group.view?.label ?? group.key}</TungstenLang>
        {errorCount > 0 ? (
          <span className={classes('tg-group-error-count')}>
            <TungstenLang params={{ count: errorCount }}>tg_ui_errors</TungstenLang>
          </span>
        ) : null}
      </summary>
      <div className={classes('tg-group-content')} style={groupSpacing(group)}>
        {group.view?.description ? (
          <p className={classes('tg-description')}>
            <TungstenLang>{group.view.description}</TungstenLang>
          </p>
        ) : null}
        {children}
      </div>
    </details>
  )
}
export function TungstenCollapsible(props: GroupRendererProps) {
  return <Disclosure {...props} kind="collapsible" />
}
export function TungstenAccordion(props: GroupRendererProps) {
  return <Disclosure {...props} kind="accordion" />
}
export function TungstenDetails(props: GroupRendererProps) {
  return <Disclosure {...props} kind="details" />
}
export function TungstenExpansionPanel(props: GroupRendererProps) {
  return <Disclosure {...props} kind="expansion-panel" />
}
