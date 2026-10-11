import {
  isGroup,
  isRepeater,
  type FormState,
  type TungstenComponent,
  type TungstenSchema,
} from '../../../api/src/types.js'

/** DOM identity follows stable repeater instances rather than the global leaf
 * ordinal. Inserting a sibling cannot rename every subsequent input or label.
 */
export function inputIds(
  schema: TungstenSchema,
  state: FormState,
  formId: string,
): ReadonlyMap<string, string> {
  const ids = new Map<string, string>()
  function visit(form: readonly TungstenComponent[], owner: string) {
    for (const component of form) {
      if (isRepeater(component)) {
        for (const instance of state.repeaters?.[component.key]?.instances ?? [])
          visit(instance.form, `${owner}/${instance.id}`)
      } else if (isGroup(component)) visit(component.subform, owner)
      else {
        const key = component.key.split('].').at(-1)!
        ids.set(
          component.key,
          `tungsten-${formId}-${encodeURIComponent(owner)}-${encodeURIComponent(key)}`,
        )
      }
    }
  }
  visit(schema.form, 'form')
  return ids
}
