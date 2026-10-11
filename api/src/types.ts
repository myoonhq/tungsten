import type { TungstenText } from './i18n.js'
export type FileReference = {
  id: string
  name: string
  size: number
  mediaType: string
  uploaded: boolean
}
export type FileValue = { files: FileReference[] }
export type ScalarValue = string | number | boolean | null | FileValue | string[]
export type DateSettings = {
  /** Defaults to date. Datetime values are stored as RFC 3339 UTC instants. */
  mode?: 'date' | 'time' | 'datetime'
  /** Datetime only: IANA identifier or fixed offset; defaults to UTC. */
  timeZone?: string
  /** Datetime only: choose an occurrence of a repeated clock time; defaults to reject. Skipped times always fail. */
  disambiguation?: 'reject' | 'earlier' | 'later'
}
export type TextSettings =
  | {
      variant?: 'plain' | 'email' | 'password' | 'tel'
      textarea?: false
      rows?: never
      resizable?: never
    }
  | { variant?: 'plain'; textarea: true; rows: number; resizable?: boolean }
export type BooleanOption = { value: boolean; label: string }
export type BooleanSettings =
  | { variant?: 'checkbox' | 'switch'; options?: never; direction?: never }
  | { variant: 'radio'; options?: BooleanOption[]; direction?: 'column' | 'row' }
export type SelectSettings = {
  multiple?: boolean
  options?: SelectOption[]
  /** Select the first successfully loaded option when no valid selection remains. Defaults to false. */
  selectFirstOption?: boolean
}
export type SelectOption = { value: string; label: string }
export type SourceBinding = {
  source: string
  apply?: 'initial' | 'live'
  params?: Record<string, { ref: string } | { value: ScalarValue }>
}
export type UploadSettings = {
  api: string
  endpoint: string
  method?: 'POST' | 'PUT' | 'PATCH'
  timing?: 'submit' | 'selection'
  fieldName?: string
  resultPath?: string
}
export type FileSettings = {
  upload: UploadSettings
  multiple?: boolean
  maxFiles?: number
  maxSize?: number
  accept?: string[]
}

export type FieldView = {
  label: string
  description?: string
  placeholder?: string
  [property: string]: unknown
}

export type FieldValidator = {
  kind: string
  [property: string]: unknown
}

type CommonField = {
  key: string
  view?: FieldView
  validators?: readonly FieldValidator[]
  rules?: readonly unknown[]
  current_value?: ScalarValue
  bindings?: { value?: SourceBinding; options?: SourceBinding }
  hidden?: boolean
  disabled?: boolean
  readOnly?: boolean
  errors?: readonly string[]
  [property: string]: unknown
}

export type TungstenField = CommonField &
  (
    | {
        type: string
        field_type?: string
      }
    | {
        type?: string
        field_type: string
      }
  )

export const SCHEMA_VERSION = 'sprout' as const

export type GroupVariant = 'basic' | 'sectioned'
export type GroupView = { label: string; description?: string }
export type GroupContainerSettings = { gap?: number }
export type GroupRowSettings = GroupContainerSettings & {
  wrap?: boolean
  align?: 'start' | 'center' | 'end' | 'stretch'
  columns?: number
}
export type GroupColumnSettings = GroupContainerSettings & {
  align?: 'start' | 'center' | 'end' | 'stretch'
}
export type GroupDisclosureSettings = GroupContainerSettings & { initiallyOpen?: boolean }
export type GroupOverlaySettings = GroupDisclosureSettings & { triggerLabel?: string }
export type GroupSectionSettings = { initialSection?: string }

// The wire descriptor stays open for registered custom renderers. Built-in
// settings below provide precise authoring types; Rust validates every input.
export type GroupRender = {
  type: string
  settings: Readonly<Record<string, unknown>>
}
export type BasicGroupRender =
  | {
      type: 'group' | 'section' | 'fieldset' | 'panel' | 'card' | 'inset' | 'fragment'
      settings: GroupContainerSettings
    }
  | { type: 'row'; settings: GroupRowSettings }
  | { type: 'column'; settings: GroupColumnSettings }
  | {
      type: 'collapsible' | 'accordion' | 'details' | 'expansion-panel'
      settings: GroupDisclosureSettings
    }
  | { type: 'modal' | 'drawer' | 'sheet'; settings: GroupOverlaySettings }
export type SectionedGroupRender = {
  type: 'tabs' | 'segmented-view' | 'wizard' | 'stepper' | 'pages' | 'carousel'
  settings: GroupSectionSettings
}

export type TungstenGroup = {
  type: 'group'
  variant: GroupVariant
  key: string
  view?: GroupView
  render: GroupRender
  subform: readonly TungstenComponent[]
}
export type TungstenRepeater = {
  type: 'repeater'
  key: string
  view?: GroupView
  template: readonly TungstenComponent[]
  render: GroupRender
  min?: number
  max?: number
  reorder?: boolean
  validators?: readonly FieldValidator[]
  current_value?: readonly RepeaterItem[]
}
export type RepeaterItem = {
  [property: string]: ScalarValue | RepeaterItem | readonly RepeaterItem[]
}
export type RepeaterInstance = {
  id: string
  label: TungstenText
  form: readonly TungstenComponent[]
}
export type RepeaterState = {
  length: number
  min: number
  max?: number
  canAdd: boolean
  canRemove: boolean
  canReorder: boolean
  errors: TungstenText[]
  instances: RepeaterInstance[]
}
export type TungstenComponent = TungstenField | TungstenGroup | TungstenRepeater
export type TungstenSchema = {
  // JSON imports widen strings; core is authoritative for supported versions.
  schemaVersion: string
  form: readonly TungstenComponent[]
}

export function isGroup(component: TungstenComponent): component is TungstenGroup {
  return component.type === 'group'
}

export function isRepeater(component: TungstenComponent): component is TungstenRepeater {
  return component.type === 'repeater'
}

/** Declaration-order leaves of an already validated schema tree. */
export function fieldsOf(
  components: readonly TungstenComponent[],
  state?: FormState,
): TungstenField[] {
  const fields: TungstenField[] = []
  const stack = [...components].reverse()
  while (stack.length > 0) {
    const component = stack.pop()!
    if (isGroup(component)) {
      for (let index = component.subform.length - 1; index >= 0; index -= 1) {
        stack.push(component.subform[index])
      }
    } else if (isRepeater(component)) {
      const instances = state?.repeaters?.[component.key]?.instances ?? []
      for (let index = instances.length - 1; index >= 0; index -= 1) {
        for (let child = instances[index].form.length - 1; child >= 0; child -= 1)
          stack.push(instances[index].form[child])
      }
    } else {
      fields.push(component)
    }
  }
  return fields
}

export type RuntimeFieldState = {
  value: ScalarValue
  hidden: boolean
  disabled?: boolean
  readOnly?: boolean
  errors: TungstenText[]
  loadingSources?: string[]
  sourceErrors?: Record<string, TungstenText>
  unresolved?: boolean
  uploading?: boolean
  uploadError?: TungstenText
  options?: (SelectOption | BooleanOption)[]
}

export type FormState = {
  fields: Record<string, RuntimeFieldState>
  repeaters?: Record<string, RepeaterState>
}

export type TungstenValues = Record<string, ScalarValue | readonly RepeaterItem[]>

export function fieldTypeOf(field: { type?: string; field_type?: string }): string {
  return (field.type ?? field.field_type) as string
}

/** Registry-owned schemas used by authoring tools. null means undescribed. */
export type ValidatorDescriptor = {
  kind: string
  label: string
  description: string
  settings: readonly TungstenComponent[]
}
export type FieldDescriptor = {
  type: string
  label: string
  description: string
  valueType: string
  settings: readonly TungstenComponent[] | null
  validators: readonly ValidatorDescriptor[]
  operations: readonly string[]
}
export type RendererDescriptor = {
  type: string
  variant: GroupVariant | null
  settings: readonly TungstenComponent[] | null
}
export type ActionDescriptor = {
  kind: string
  label: string
  settings: readonly TungstenComponent[]
}
export type AuthoringCatalog = {
  schemaVersion: string
  maxDepth: number
  fields: readonly FieldDescriptor[]
  commonSettings: readonly TungstenComponent[]
  groupSettings: readonly TungstenComponent[]
  repeaterSettings: readonly TungstenComponent[]
  groupRenderers: readonly RendererDescriptor[]
  repeaterRenderers: readonly RendererDescriptor[]
  actions: readonly ActionDescriptor[]
}
export type TungstenSnapshot = {
  schema: TungstenSchema
  state: FormState
  values: TungstenValues
  valid: boolean
}
