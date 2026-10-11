import { fieldTypeOf, isGroup, isRepeater } from '../../../../api/src/types.js'
import type { AuthoringCatalog, TungstenComponent, TungstenSchema } from '../types.js'
import {
  childrenOf,
  componentAt,
  newComponent,
  renameSchema,
  replaceAt,
  type ComponentPath,
} from './model.js'
import { relocateCollectionDefaults } from './initial-values.js'

export type EditorDrag =
  | { kind: 'palette'; type: string }
  | { kind: 'component'; path: ComponentPath }
export type DropLocation = { parent: ComponentPath; index: number }
const samePath = (a: ComponentPath, b: ComponentPath) =>
  a.length === b.length && a.every((index, depth) => index === b[depth])
const inside = (path: ComponentPath, ancestor: ComponentPath) =>
  path.length >= ancestor.length && ancestor.every((index, depth) => index === path[depth])
export function dropProblem(
  schema: TungstenSchema,
  drag: EditorDrag,
  target: DropLocation,
): string | null {
  const parent = target.parent.length ? componentAt(schema, target.parent) : undefined
  if (target.parent.length && (!parent || (!isGroup(parent) && !isRepeater(parent))))
    return 'tg_editor_drop_into_the_form_a_group_or_a_repeater_template'
  const children = parent ? childrenOf(parent) : schema.form
  if (!Number.isInteger(target.index) || target.index < 0 || target.index > children.length)
    return 'tg_editor_this_position_is_no_longer_available'
  const source = drag.kind === 'component' ? componentAt(schema, drag.path) : undefined
  if (drag.kind === 'component') {
    if (!source) return 'tg_editor_this_component_is_no_longer_available'
    if (inside(target.parent, drag.path))
      return 'tg_editor_a_component_cannot_be_moved_inside_itself'
  }
  const type = source ? fieldTypeOf(source) : drag.kind === 'palette' ? drag.type : ''
  if (
    parent &&
    isGroup(parent) &&
    parent.variant === 'sectioned' &&
    (type !== 'group' || (source && (!isGroup(source) || source.variant !== 'basic')))
  )
    return 'tg_editor_sectioned_layouts_contain_basic_groups_drop_a_group_here_first'
  return null
}
function insert(
  schema: TungstenSchema,
  target: DropLocation,
  component: TungstenComponent,
): TungstenSchema {
  const parent = componentAt(schema, target.parent)
  const children = [...(parent ? childrenOf(parent) : schema.form)]
  children.splice(target.index, 0, component)
  return parent
    ? replaceAt(
        schema,
        target.parent,
        isGroup(parent) ? { ...parent, subform: children } : { ...parent, template: children },
      )
    : { ...schema, form: children }
}
function keysOf(schema: TungstenSchema) {
  const keys = new Set<string>()
  function walk(components: readonly TungstenComponent[]) {
    for (const component of components) {
      keys.add(component.key)
      walk(childrenOf(component))
    }
  }
  walk(schema.form)
  return keys
}
function repeaterOwners(schema: TungstenSchema, path: ComponentPath): string[] {
  return path.slice(0, -1).flatMap((_, depth) => {
    const parent = componentAt(schema, path.slice(0, depth + 1))
    return parent && isRepeater(parent) ? [parent.key] : []
  })
}
/** Atomic authoring transaction; evaluation remains an ordinary core load. */
export function arrange(
  schema: TungstenSchema,
  drag: EditorDrag,
  target: DropLocation,
  catalog: AuthoringCatalog,
): { schema: TungstenSchema; selection: ComponentPath } {
  const problem = dropProblem(schema, drag, target)
  if (problem) throw new Error(problem)
  const parent = componentAt(schema, target.parent)
  const prefix = parent ? `${parent.key}.` : ''
  if (drag.kind === 'palette') {
    if (!['group', 'repeater', ...catalog.fields.map((field) => field.type)].includes(drag.type))
      throw new Error(
        JSON.stringify({
          messageKey: 'tg_editor_choose_a_registered_component_from_the_palette',
          params: {},
        }),
      )
    const keys = keysOf(schema)
    let ordinal = 1
    while (keys.has(`${prefix}${drag.type}${ordinal}`)) ordinal += 1
    const component = newComponent(drag.type, `${prefix}${drag.type}${ordinal}`, catalog)
    return {
      schema: insert(schema, target, component),
      selection: [...target.parent, target.index],
    }
  }
  const source = componentAt(schema, drag.path)!
  const sourceParent = drag.path.slice(0, -1)
  const sameParent = samePath(sourceParent, target.parent)
  const index = sameParent && target.index > drag.path.at(-1)! ? target.index - 1 : target.index
  if (sameParent && index === drag.path.at(-1)) return { schema, selection: drag.path }
  let key = source.key
  if (!sameParent) {
    const keys = keysOf(replaceAt(schema, drag.path, null))
    const name = source.key.split('.').at(-1)!
    key = `${prefix}${name}`
    const subtree = [...keysOf({ ...schema, form: [source] })]
    const collides = (candidate: string) =>
      subtree.some((oldKey) => keys.has(`${candidate}${oldKey.slice(source.key.length)}`))
    let suffix = 2
    while (collides(key)) key = `${prefix}${name}${suffix++}`
  }
  const beforeOwners = repeaterOwners(schema, drag.path)
  const afterOwners = repeaterOwners(schema, [...target.parent, target.index])
  const sameCollections = JSON.stringify(beforeOwners) === JSON.stringify(afterOwners)
  const relocated =
    key === source.key
      ? schema
      : relocateCollectionDefaults(schema, source.key, key, sameCollections)
  let result = key === source.key ? relocated : renameSchema(relocated, source.key, key)
  const moved = componentAt(result, drag.path)!
  result = replaceAt(result, drag.path, null)
  const parentPath = [...target.parent]
  if (
    inside(parentPath, sourceParent) &&
    parentPath.length > sourceParent.length &&
    parentPath[sourceParent.length] > drag.path.at(-1)!
  )
    parentPath[sourceParent.length] -= 1
  const nextTarget = { parent: parentPath, index }
  result = insert(result, nextTarget, moved)
  // Moving the active section out of its group should use that renderer's
  // ordinary default, rather than retaining an invalid initialSection setting.
  function cleanSections(components: readonly TungstenComponent[]): TungstenComponent[] {
    return components.map((component) => {
      if (isGroup(component)) {
        const settings = { ...component.render.settings }
        if (
          typeof settings.initialSection === 'string' &&
          !component.subform.some((child) => child.key === settings.initialSection)
        )
          delete settings.initialSection
        return {
          ...component,
          render: { ...component.render, settings },
          subform: cleanSections(component.subform),
        }
      }
      return isRepeater(component)
        ? { ...component, template: cleanSections(component.template) }
        : component
    })
  }
  return {
    schema: { ...result, form: cleanSections(result.form) },
    selection: [...parentPath, index],
  }
}
