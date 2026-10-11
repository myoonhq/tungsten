import { useRendererClasses, useRendererComponents } from './appearance.js'
import { TungstenLang, useTungstenLang } from '../../../framework/react/src/i18n.js'
import type { KeyboardEvent } from 'react'
import type {
  GroupRendererProps,
  GroupSectionSettings,
} from '../../../framework/react/src/types.js'
import { GroupHeading, settingsOf, useGroupPresentation } from './group-shared.js'

function useSection(props: GroupRendererProps) {
  const initial = settingsOf<GroupSectionSettings>(props.group).initialSection
  const initialIndex = Math.max(
    0,
    props.sections.findIndex((section) => section.group.key === initial),
  )
  return useGroupPresentation(initialIndex, props, (fieldKey) => {
    const index = props.sections.findIndex((section) => section.fieldKeys.includes(fieldKey))
    return index >= 0 ? index : undefined
  })
}

function Tabs(props: GroupRendererProps & { kind: string }) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t } = useTungstenLang()

  const { group, groupId, sections, disabled, kind } = props
  const [active, select] = useSection(props)
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % sections.length
    else if (event.key === 'ArrowLeft') next = (index + sections.length - 1) % sections.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = sections.length - 1
    else return
    event.preventDefault()
    select(next)
    document.getElementById(`${sections[next].id}-tab`)?.focus()
  }
  return (
    <section className={classes(`tg-group tg-group--${kind}`)}>
      <GroupHeading group={group} groupId={groupId} />
      <div
        className={classes('tg-section-nav')}
        role="tablist"
        aria-label={t(group.view?.label ?? group.key)}
      >
        {sections.map((section, index) => (
          <Button
            className={classes(`tg-tab${active === index ? ' active' : ''}`)}
            key={
              section.group.key.includes('].')
                ? section.group.key.split('].').at(-1)!
                : section.group.key
            }
            type="button"
            role="tab"
            id={`${section.id}-tab`}
            aria-controls={section.id}
            aria-selected={active === index}
            tabIndex={active === index ? 0 : -1}
            disabled={disabled}
            onClick={() => select(index)}
            onKeyDown={(event) => navigate(event, index)}
          >
            <TungstenLang>{section.label}</TungstenLang>
            {section.errorCount > 0 ? (
              <span className={classes('tg-group-error-count')}>
                <TungstenLang params={{ count: section.errorCount }}>tg_ui_errors</TungstenLang>
              </span>
            ) : null}
          </Button>
        ))}
      </div>
      {sections.map((section, index) => (
        <div
          key={
            section.group.key.includes('].')
              ? section.group.key.split('].').at(-1)!
              : section.group.key
          }
          id={section.id}
          role="tabpanel"
          aria-labelledby={`${section.id}-tab`}
          hidden={active !== index}
          tabIndex={0}
        >
          {section.content}
        </div>
      ))}
    </section>
  )
}
export function TungstenTabs(props: GroupRendererProps) {
  return <Tabs {...props} kind="tabs" />
}
export function TungstenSegmentedView(props: GroupRendererProps) {
  return <Tabs {...props} kind="segmented-view" />
}

function Sequence(props: GroupRendererProps & { kind: string; indicators?: boolean }) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t } = useTungstenLang()

  const { group, groupId, sections, disabled, kind, indicators } = props
  const [active, select] = useSection(props)
  return (
    <section className={classes(`tg-group tg-group--${kind}`)}>
      <GroupHeading group={group} groupId={groupId} />
      {indicators ? (
        <ol className={classes('tg-step-indicators')} aria-label={t('tg_ui_steps')}>
          {sections.map((section, index) => (
            <li
              key={
                section.group.key.includes('].')
                  ? section.group.key.split('].').at(-1)!
                  : section.group.key
              }
            >
              <Button
                className={classes('tg-button')}
                type="button"
                disabled={disabled}
                aria-current={active === index ? 'step' : undefined}
                aria-controls={section.id}
                onClick={() => select(index)}
              >
                <span className={classes('tg-step-number')}>{index + 1}</span>{' '}
                <TungstenLang>{section.label}</TungstenLang>
                {section.errorCount > 0 ? (
                  <span className={classes('tg-group-error-count')}>
                    <TungstenLang params={{ count: section.errorCount }}>tg_ui_errors</TungstenLang>
                  </span>
                ) : null}
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      {sections.length > 0 ? (
        <p className={classes('tg-section-progress')} role="status">
          {active + 1} / {sections.length} · <TungstenLang>{sections[active]?.label}</TungstenLang>
        </p>
      ) : null}
      {sections.map((section, index) => (
        <div
          key={
            section.group.key.includes('].')
              ? section.group.key.split('].').at(-1)!
              : section.group.key
          }
          id={section.id}
          role="region"
          aria-label={t(section.label)}
          hidden={active !== index}
        >
          {section.content}
        </div>
      ))}
      {sections.length > 0 ? (
        <nav
          className={classes('tg-section-actions')}
          aria-label={t('tg_ui_navigation', { p0: { messageKey: group.view?.label ?? group.key } })}
        >
          <Button
            className={classes('tg-button')}
            type="button"
            disabled={disabled || active === 0}
            onClick={() => select(active - 1)}
          >
            <TungstenLang>tg_ui_previous</TungstenLang>
          </Button>
          <Button
            className={classes('tg-button')}
            type="button"
            disabled={disabled || active >= sections.length - 1}
            onClick={() => select(active + 1)}
          >
            <TungstenLang>tg_ui_next</TungstenLang>
          </Button>
        </nav>
      ) : null}
    </section>
  )
}
export function TungstenWizard(props: GroupRendererProps) {
  return <Sequence {...props} kind="wizard" />
}
export function TungstenStepper(props: GroupRendererProps) {
  return <Sequence {...props} kind="stepper" indicators />
}
export function TungstenPages(props: GroupRendererProps) {
  return <Sequence {...props} kind="pages" />
}
export function TungstenCarousel(props: GroupRendererProps) {
  return <Sequence {...props} kind="carousel" />
}
