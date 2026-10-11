import { useRendererClasses } from './appearance.js'
import { TungstenLang } from '../../../framework/react/src/i18n.js'
import { useState, type CSSProperties } from 'react'
import type { GroupRendererProps, TungstenGroup } from '../../../framework/react/src/types.js'

export function settingsOf<T>(group: TungstenGroup): T {
  return group.render.settings as T
}

export function groupSpacing(group: TungstenGroup): CSSProperties {
  const gap = group.render.settings.gap
  return typeof gap === 'number' ? { gap: `${gap}px` } : {}
}

/** A new invalid-submit request reveals a section once; later user navigation wins. */
export function useGroupPresentation<T>(
  initial: T,
  props: GroupRendererProps,
  revealValue: (fieldKey: string) => T | undefined,
): [T, (value: T) => void] {
  const [presentation, setPresentation] = useState({ requestId: 0, value: initial })
  const requestId = props.reveal?.requestId ?? 0
  let current = presentation
  if (presentation.requestId !== requestId) {
    const fieldKey = props.reveal?.fieldKey
    current = {
      requestId,
      value: fieldKey ? (revealValue(fieldKey) ?? presentation.value) : presentation.value,
    }
    // Adjust only this component's presentation when a new request arrives.
    setPresentation(current)
  }
  return [current.value, (value) => setPresentation({ requestId, value })]
}

export function containsField(group: TungstenGroup, fieldKey: string): boolean {
  return fieldKey.startsWith(`${group.key}.`)
}

export function GroupHeading({ group, groupId }: Pick<GroupRendererProps, 'group' | 'groupId'>) {
  const classes = useRendererClasses()
  return (
    <>
      {group.view?.label ? (
        <h3 className={classes('tg-group-title')} id={`${groupId}-title`}>
          <TungstenLang>{group.view.label}</TungstenLang>
        </h3>
      ) : null}
      {group.view?.description ? (
        <p className={classes('tg-description')}>
          <TungstenLang>{group.view.description}</TungstenLang>
        </p>
      ) : null}
    </>
  )
}
