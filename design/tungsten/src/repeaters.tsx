import { useRendererClasses, useRendererComponents } from './appearance.js'
import { TungstenLang, useTungstenLang } from '../../../framework/react/src/i18n.js'
import { useState, type KeyboardEvent } from 'react'
import type { RepeaterRendererProps } from '../../../framework/react/src/types.js'

function Controls({ props, index }: { props: RepeaterRendererProps; index: number }) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t } = useTungstenLang()

  const { state, instances, disabled, onRemove, onReorder } = props
  const label = instances[index].label
  return (
    <div className={classes('tg-repeater-actions')}>
      {state.canReorder ? (
        <>
          <Button
            className={classes('tg-button')}
            type="button"
            disabled={disabled || index === 0}
            aria-label={t('tg_ui_move_earlier', { p0: t(label) })}
            onClick={() => onReorder(index, index - 1)}
          >
            ↑
          </Button>
          <Button
            className={classes('tg-button')}
            type="button"
            disabled={disabled || index === instances.length - 1}
            aria-label={t('tg_ui_move_later', { p0: t(label) })}
            onClick={() => onReorder(index, index + 1)}
          >
            ↓
          </Button>
        </>
      ) : null}
      <Button
        className={classes('tg-button')}
        type="button"
        disabled={disabled || !state.canRemove}
        aria-label={t('tg_ui_remove_2', { p0: t(label) })}
        onClick={() => onRemove(index)}
      >
        −
      </Button>
    </div>
  )
}
function Heading({ repeater, repeaterId, state, disabled, onAdd }: RepeaterRendererProps) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t } = useTungstenLang()

  return (
    <>
      <header className={classes('tg-repeater-heading')}>
        <h2 id={`${repeaterId}-heading`}>
          <TungstenLang>{repeater.view?.label ?? repeater.key}</TungstenLang>
        </h2>
        <Button
          className={classes('tg-button')}
          type="button"
          disabled={disabled || !state.canAdd}
          aria-label={t('tg_ui_add_to', { p0: t(repeater.view?.label ?? repeater.key) })}
          onClick={onAdd}
        >
          +
        </Button>
      </header>
      {repeater.view?.description ? (
        <p>
          <TungstenLang>{repeater.view.description}</TungstenLang>
        </p>
      ) : null}
      {state.errors.length ? (
        <ul className={classes('tg-errors')} role="alert">
          {state.errors.map((error, index) => (
            <li key={index}>
              <TungstenLang>{error}</TungstenLang>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
export function TungstenRepeaterStack(props: RepeaterRendererProps) {
  const classes = useRendererClasses()
  const { t } = useTungstenLang()

  const gap = props.repeater.render.settings.gap as number | undefined
  return (
    <section className={classes('tg-repeater')} aria-labelledby={`${props.repeaterId}-heading`}>
      <Heading {...props} />
      <div
        className={classes('tg-repeater-stack')}
        style={{ gap: gap === undefined ? undefined : `${gap}px` }}
      >
        {props.instances.map((instance, index) => (
          <section
            key={instance.id}
            className={classes('tg-repeater-instance')}
            aria-label={t(instance.label)}
          >
            <header className={classes('tg-repeater-heading')}>
              <h3>
                <TungstenLang>{instance.label}</TungstenLang>
              </h3>
              <Controls props={props} index={index} />
            </header>
            {instance.content}
          </section>
        ))}
      </div>
    </section>
  )
}
export function TungstenRepeaterTabs(props: RepeaterRendererProps) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t } = useTungstenLang()

  const { instances, repeaterId, disabled, reveal } = props
  const initial = props.repeater.render.settings.initialIndex as number | undefined
  const [selected, select] = useState<string | undefined>(instances[initial ?? 0]?.id)
  const [handledReveal, setHandledReveal] = useState(0)
  const revealed =
    reveal && reveal.requestId !== handledReveal
      ? instances.find((instance) => instance.fieldKeys.includes(reveal.fieldKey))
      : undefined
  if (revealed && reveal) {
    select(revealed.id)
    setHandledReveal(reveal.requestId)
  }
  const active = instances.some((instance) => instance.id === selected)
    ? selected
    : instances[0]?.id
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % instances.length
    else if (event.key === 'ArrowLeft') next = (index + instances.length - 1) % instances.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = instances.length - 1
    else return
    event.preventDefault()
    select(instances[next].id)
    document.getElementById(`${repeaterId}-${instances[next].id}-tab`)?.focus()
  }
  return (
    <section className={classes('tg-repeater')} aria-labelledby={`${repeaterId}-heading`}>
      <Heading {...props} />
      {instances.length ? (
        <div
          className={classes('tg-section-nav')}
          role="tablist"
          aria-label={t(props.repeater.view?.label ?? props.repeater.key)}
        >
          {instances.map((instance, index) => (
            <Button
              className={classes(`tg-tab${active === instance.id ? ' active' : ''}`)}
              type="button"
              role="tab"
              key={instance.id}
              id={`${repeaterId}-${instance.id}-tab`}
              aria-controls={`${repeaterId}-${instance.id}-panel`}
              aria-selected={active === instance.id}
              tabIndex={active === instance.id ? 0 : -1}
              disabled={disabled}
              onClick={() => select(instance.id)}
              onKeyDown={(event) => navigate(event, index)}
            >
              <TungstenLang>{instance.label}</TungstenLang>
              {instance.errorCount ? (
                <span className={classes('tg-group-error-count')}>
                  <TungstenLang params={{ count: instance.errorCount }}>tg_ui_errors</TungstenLang>
                </span>
              ) : null}
            </Button>
          ))}
        </div>
      ) : null}
      {instances.map((instance, index) => (
        <div
          key={instance.id}
          role="tabpanel"
          hidden={active !== instance.id}
          id={`${repeaterId}-${instance.id}-panel`}
          aria-labelledby={`${repeaterId}-${instance.id}-tab`}
        >
          <header className={classes('tg-repeater-heading')}>
            <h3>
              <TungstenLang>{instance.label}</TungstenLang>
            </h3>
            <Controls props={props} index={index} />
          </header>
          {instance.content}
        </div>
      ))}
    </section>
  )
}
