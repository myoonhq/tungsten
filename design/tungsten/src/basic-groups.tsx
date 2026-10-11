import { useRendererClasses } from './appearance.js'
import { TungstenLang, useTungstenLang } from '../../../framework/react/src/i18n.js'
import type {
  GroupColumnSettings,
  GroupRendererProps,
  GroupRowSettings,
} from '../../../framework/react/src/types.js'
import { GroupHeading, groupSpacing, settingsOf } from './group-shared.js'

export function TungstenGroup({ group, children }: GroupRendererProps) {
  const classes = useRendererClasses()
  const { t } = useTungstenLang()

  return (
    <div
      className={classes('tg-group')}
      role="group"
      aria-label={t(group.view?.label)}
      style={groupSpacing(group)}
    >
      {children}
    </div>
  )
}
export function TungstenFragment({ children }: GroupRendererProps) {
  return <>{children}</>
}

function Surface({ kind, ...props }: GroupRendererProps & { kind: string }) {
  const classes = useRendererClasses()
  const { group, groupId, children } = props
  return (
    <section
      className={classes(`tg-group tg-group--${kind}`)}
      aria-labelledby={group.view?.label ? `${groupId}-title` : undefined}
    >
      <GroupHeading group={group} groupId={groupId} />
      <div className={classes('tg-group-content')} style={groupSpacing(group)}>
        {children}
      </div>
    </section>
  )
}
export function TungstenSection(props: GroupRendererProps) {
  return <Surface {...props} kind="section" />
}
export function TungstenPanel(props: GroupRendererProps) {
  return <Surface {...props} kind="panel" />
}
export function TungstenCard(props: GroupRendererProps) {
  return <Surface {...props} kind="card" />
}
export function TungstenInset(props: GroupRendererProps) {
  return <Surface {...props} kind="inset" />
}
export function TungstenFieldset({ group, children, disabled }: GroupRendererProps) {
  const classes = useRendererClasses()
  return (
    <fieldset
      className={classes('tg-group tg-group--fieldset')}
      disabled={disabled}
      style={groupSpacing(group)}
    >
      <legend className={classes('tg-group-title')}>
        <TungstenLang>{group.view?.label ?? group.key}</TungstenLang>
      </legend>
      {group.view?.description ? (
        <p className={classes('tg-description')}>
          <TungstenLang>{group.view.description}</TungstenLang>
        </p>
      ) : null}
      {children}
    </fieldset>
  )
}
export function TungstenRow({ group, children }: GroupRendererProps) {
  const classes = useRendererClasses()
  const { t } = useTungstenLang()

  const settings = settingsOf<GroupRowSettings>(group)
  return (
    <div
      className={classes('tg-group tg-group--row')}
      role="group"
      aria-label={t(group.view?.label)}
      style={{
        ...groupSpacing(group),
        flexWrap: settings.wrap === false ? 'nowrap' : 'wrap',
        alignItems:
          settings.align === 'start'
            ? 'flex-start'
            : settings.align === 'end'
              ? 'flex-end'
              : settings.align,
        ...(settings.columns
          ? { display: 'grid', gridTemplateColumns: `repeat(${settings.columns}, minmax(0, 1fr))` }
          : {}),
      }}
    >
      {children}
    </div>
  )
}
export function TungstenColumn({ group, children }: GroupRendererProps) {
  const classes = useRendererClasses()
  const { t } = useTungstenLang()

  const settings = settingsOf<GroupColumnSettings>(group)
  return (
    <div
      className={classes('tg-group tg-group--column')}
      role="group"
      aria-label={t(group.view?.label)}
      style={{ ...groupSpacing(group), alignItems: settings.align }}
    >
      {children}
    </div>
  )
}
