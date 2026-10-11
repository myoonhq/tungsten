import { TungstenLang, useTungstenLang } from '../i18n.js'
import { useState, type DragEvent } from 'react'
import { fieldTypeOf, isGroup, isRepeater } from '../../../../api/src/types.js'
import type { TungstenComponent, TungstenSchema } from '../types.js'
import { childrenOf, componentAt, type ComponentPath } from './model.js'
import { dropProblem, type DropLocation, type EditorDrag } from './arrangement.js'

export const EDITOR_DRAG_MIME = 'application/x-tungsten-component'
export type DragHandlers = {
  onDragStart: (event: DragEvent<HTMLElement>, drag: EditorDrag) => void
  onDragEnd: () => void
}
type CanvasProps = DragHandlers & {
  schema: TungstenSchema
  selection: ComponentPath
  drag: EditorDrag | null
  pending: boolean
  onSelect: (path: ComponentPath) => void
  onDrop: (event: DragEvent<HTMLElement>, target: DropLocation) => void
  onMove: (path: ComponentPath, target: DropLocation) => void
}
export function EditorCanvas(props: CanvasProps) {
  const { t } = useTungstenLang()
  const [over, setOver] = useState<string | null>(null)
  const selected = componentAt(props.schema, props.selection)
  const endpoint = (target: DropLocation) => `${target.parent.join('.')}:${target.index}`
  function dragOver(event: DragEvent<HTMLElement>, target: DropLocation) {
    if (props.pending || !props.drag || dropProblem(props.schema, props.drag, target)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = props.drag.kind === 'palette' ? 'copy' : 'move'
    setOver(endpoint(target))
  }
  function drop(event: DragEvent<HTMLElement>, target: DropLocation) {
    event.preventDefault()
    event.stopPropagation()
    setOver(null)
    props.onDrop(event, target)
  }
  function zone(target: DropLocation, label: string, empty = false, last = false) {
    const allowed = !!props.drag && !dropProblem(props.schema, props.drag, target)
    const canMove =
      !!selected && !dropProblem(props.schema, { kind: 'component', path: props.selection }, target)
    return (
      <div
        key={`drop-${target.index}`}
        className={`te-drop-zone ${empty ? 'te-drop-empty' : ''} ${over === endpoint(target) && allowed ? 'te-drop-over' : ''} ${props.drag && !allowed ? 'te-drop-blocked' : ''}`}
        data-drop-parent={target.parent.join('.')}
        data-drop-index={target.index}
        aria-label={t(label)}
        onDragOver={(event) => dragOver(event, target)}
        onDragLeave={() => setOver((current) => (current === endpoint(target) ? null : current))}
        onDrop={(event) => drop(event, target)}
      >
        <span>
          <TungstenLang>{empty ? label : 'tg_editor_drop_here'}</TungstenLang>
        </span>
        {last && !props.drag && canMove ? (
          <button
            type="button"
            disabled={props.pending}
            aria-label={t('tg_editor_move', { p0: selected!.key, p1: t(label) })}
            onClick={() => props.onMove(props.selection, target)}
          >
            <TungstenLang>tg_editor_move_selected_here</TungstenLang>
          </button>
        ) : null}
      </div>
    )
  }
  function list(components: readonly TungstenComponent[], parent: ComponentPath, label: string) {
    if (!components.length)
      return zone(
        { parent, index: 0 },
        t('tg_editor_into', { label: { messageKey: label } }),
        true,
        true,
      )
    return (
      <div className="te-canvas-list">
        {components.map((component, index) => {
          const path = [...parent, index]
          const container = isGroup(component) || isRepeater(component)
          const target = { parent: path, index: childrenOf(component).length }
          const active = props.selection.join('.') === path.join('.')
          const dragging =
            props.drag?.kind === 'component' && props.drag.path.join('.') === path.join('.')
          return (
            <div className="te-canvas-entry" key={component.key}>
              {zone({ parent, index }, t('tg_editor_before', { key: component.key }))}
              <div
                className={`te-canvas-card ${container ? 'te-canvas-container' : 'te-canvas-field'} ${active ? 'te-canvas-selected' : ''} ${dragging ? 'te-canvas-moving' : ''} ${container && props.drag && over === endpoint(target) ? 'te-canvas-target' : ''}`}
                data-component-key={component.key}
                onDragOver={container ? (event) => dragOver(event, target) : undefined}
                onDragLeave={
                  container
                    ? (event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                          setOver(null)
                      }
                    : undefined
                }
                onDrop={container ? (event) => drop(event, target) : undefined}
              >
                <div className="te-canvas-card-heading">
                  <button
                    type="button"
                    className="te-drag-handle"
                    draggable={!props.pending}
                    disabled={props.pending}
                    aria-label={t('tg_editor_drag', { p0: component.key })}
                    title={t('tg_editor_drag_to_move')}
                    onDragStart={(event) => props.onDragStart(event, { kind: 'component', path })}
                    onDragEnd={props.onDragEnd}
                  >
                    <span aria-hidden="true">⠿</span>
                  </button>
                  <button
                    type="button"
                    className="te-canvas-select"
                    disabled={props.pending}
                    aria-pressed={active}
                    onClick={() => props.onSelect(path)}
                  >
                    <strong>
                      <TungstenLang>{component.view?.label || component.key}</TungstenLang>
                    </strong>
                    <small>{component.key}</small>
                  </button>
                  <span className="te-canvas-type">
                    <TungstenLang>
                      {isRepeater(component)
                        ? 'tg_editor_template'
                        : isGroup(component)
                          ? component.render.type
                          : fieldTypeOf(component)}
                    </TungstenLang>
                  </span>
                  <div className="te-canvas-order">
                    <button
                      type="button"
                      disabled={props.pending || index === 0}
                      aria-label={t('tg_editor_move_up', { p0: component.key })}
                      onClick={() => props.onMove(path, { parent, index: index - 1 })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={props.pending || index === components.length - 1}
                      aria-label={t('tg_editor_move_down', { p0: component.key })}
                      onClick={() => props.onMove(path, { parent, index: index + 2 })}
                    >
                      ↓
                    </button>
                  </div>
                </div>
                {container ? (
                  <div className="te-canvas-children">
                    <p className="te-canvas-caption">
                      <TungstenLang>
                        {isRepeater(component)
                          ? 'tg_editor_repeating_template_design_one_instance'
                          : component.variant === 'sectioned'
                            ? 'tg_editor_drop_basic_groups_as_sections'
                            : 'tg_editor_group_contents'}
                      </TungstenLang>
                    </p>
                    {list(childrenOf(component), path, component.view?.label || component.key)}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
        {zone(
          { parent, index: components.length },
          t('tg_editor_into', { label: { messageKey: label } }),
          false,
          true,
        )}
      </div>
    )
  }
  return (
    <section
      className={`te-canvas ${props.drag ? 'te-canvas-dragging' : ''}`}
      aria-label={t('tg_editor_form_layout')}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null)
      }}
    >
      <div className="te-canvas-heading">
        <div>
          <p className="te-kicker">
            <TungstenLang>tg_editor_arrange_your_form</TungstenLang>
          </p>
          <h2>
            <TungstenLang>tg_editor_form_layout</TungstenLang>
          </h2>
        </div>
        <button type="button" onClick={() => props.onSelect([])} disabled={props.pending}>
          <TungstenLang>tg_editor_select_root</TungstenLang>
        </button>
      </div>
      <p className="te-muted">
        <TungstenLang>
          tg_editor_drag_components_from_the_palette_drop_inside_a_group_or_template_or_between_fields_to_
        </TungstenLang>
      </p>
      {list(props.schema.form, [], 'tg_editor_form_root')}
    </section>
  )
}
