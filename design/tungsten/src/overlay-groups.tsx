import { useRendererClasses, useRendererComponents } from './appearance.js'
import { TungstenLang, useTungstenLang } from '../../../framework/react/src/i18n.js'
import { useEffect, useRef } from 'react'
import type {
  GroupOverlaySettings,
  GroupRendererProps,
} from '../../../framework/react/src/types.js'
import {
  containsField,
  GroupHeading,
  groupSpacing,
  settingsOf,
  useGroupPresentation,
} from './group-shared.js'

function Overlay(props: GroupRendererProps & { kind: string }) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t } = useTungstenLang()

  const { group, groupId, children, disabled, kind } = props
  const settings = settingsOf<GroupOverlaySettings>(group)
  const [open, setOpen] = useGroupPresentation(
    settings.initiallyOpen ?? false,
    props,
    (fieldKey) => (containsField(group, fieldKey) ? true : undefined),
  )
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    else if (!open && element.open) element.close()
  }, [open])
  return (
    <div className={classes('tg-group')}>
      <Button
        className={classes('tg-group-trigger')}
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-controls={groupId}
        onClick={() => setOpen(true)}
      >
        <TungstenLang>{settings.triggerLabel ?? group.view?.label ?? group.key}</TungstenLang>
      </Button>
      <dialog
        ref={dialog}
        id={groupId}
        className={classes(`tg-group-dialog tg-group-dialog--${kind}`)}
        aria-label={t(group.view?.label ?? group.key)}
        onCancel={(event) => {
          if (disabled) event.preventDefault()
          else setOpen(false)
        }}
        onClose={() => {
          setOpen(false)
          trigger.current?.focus()
        }}
      >
        <div className={classes('tg-group-dialog-header')}>
          <div className={classes('tg-group-dialog-copy')}>
            <GroupHeading group={group} groupId={groupId} />
          </div>
          <Button
            type="button"
            className={classes('tg-group-close')}
            disabled={disabled}
            aria-label={t('tg_ui_close')}
            onClick={() => setOpen(false)}
          >
            ×
          </Button>
        </div>
        <div className={classes('tg-group-content')} style={groupSpacing(group)}>
          {children}
        </div>
      </dialog>
    </div>
  )
}
export function TungstenModal(props: GroupRendererProps) {
  return <Overlay {...props} kind="modal" />
}
export function TungstenDrawer(props: GroupRendererProps) {
  return <Overlay {...props} kind="drawer" />
}
export function TungstenSheet(props: GroupRendererProps) {
  return <Overlay {...props} kind="sheet" />
}
