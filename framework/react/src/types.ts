import type { TungstenText } from '../../../api/src/i18n.js'
import type { ComponentType, FormEventHandler, PropsWithChildren, ReactNode } from 'react'
import type {
  RuntimeFieldState,
  ScalarValue,
  TungstenField,
  TungstenSchema,
  TungstenValues,
  TungstenGroup,
  GroupVariant,
  TungstenRepeater,
  RepeaterState,
} from '../../../api/src/types.js'

export type {
  AuthoringCatalog,
  FieldDescriptor,
  ValidatorDescriptor,
  RendererDescriptor,
  ActionDescriptor,
  TungstenSnapshot,
  TungstenRepeater,
  RepeaterItem,
  RepeaterState,
  RepeaterInstance,
  BasicGroupRender,
  SectionedGroupRender,
  GroupRender,
  GroupVariant,
  GroupView,
  GroupContainerSettings,
  GroupRowSettings,
  GroupColumnSettings,
  GroupDisclosureSettings,
  GroupOverlaySettings,
  GroupSectionSettings,
  TungstenComponent,
  TungstenGroup,
  FieldValidator,
  FieldView,
  FormState,
  RuntimeFieldState,
  ScalarValue,
  TungstenField,
  TungstenSchema,
  TungstenValues,
} from '../../../api/src/types.js'

export type FieldRendererProps = {
  field: TungstenField
  state: RuntimeFieldState
  inputId: string
  required: boolean
  disabled: boolean
  readOnly: boolean
  onValueChange: (value: ScalarValue) => void | Promise<void>
  onFilesChange?: (files: readonly File[]) => void
  onRetry?: () => void
}

export type DesignFormProps = PropsWithChildren<{
  onSubmit: FormEventHandler<HTMLFormElement>
  submitting: boolean
  busy?: boolean
  saveStatus?: import('../../../api/src/operations.js').OperationStatus
  submitStatus?: import('../../../api/src/operations.js').OperationStatus
  error: TungstenText | null
}>

export type DesignMessageProps = {
  message?: TungstenText
}

export type GroupRevealRequest = { fieldKey: string; requestId: number }
export type GroupSection = {
  group: TungstenGroup
  id: string
  label: string
  fieldKeys: readonly string[]
  errorCount: number
  content: ReactNode
}
export type GroupRendererProps = {
  group: TungstenGroup
  groupId: string
  children: ReactNode
  sections: readonly GroupSection[]
  disabled: boolean
  errorCount: number
  reveal: GroupRevealRequest | null
}
export type GroupRendererDefinition = {
  variant: GroupVariant
  Renderer: ComponentType<GroupRendererProps>
}

export type RepeaterSection = {
  id: string
  label: TungstenText
  fieldKeys: readonly string[]
  errorCount: number
  content: ReactNode
}
export type RepeaterRendererProps = {
  repeater: TungstenRepeater
  state: RepeaterState
  repeaterId: string
  instances: readonly RepeaterSection[]
  disabled: boolean
  reveal: GroupRevealRequest | null
  onAdd: () => void
  onRemove: (index: number) => void
  onReorder: (from: number, to: number) => void
}

export type TungstenDesign = {
  name: string
  /** Field renderers that provide their own accessible loading indicator. */
  loadingIndicators?: readonly string[]
  fields: Readonly<Record<string, ComponentType<FieldRendererProps>>>
  groups?: Readonly<Record<string, GroupRendererDefinition>>
  repeaters?: Readonly<Record<string, ComponentType<RepeaterRendererProps>>>
  Form: ComponentType<DesignFormProps>
  Loading: ComponentType<DesignMessageProps>
  Failure: ComponentType<DesignMessageProps>
  install?: () => void
}

export type TungstenDiagnostic = {
  severity: 'error' | 'warning'
  messageKey: string
  params: import('../../../api/src/i18n.js').MessageParameters
  message: string
}
export type TungstenProps = {
  /** Presentation only; inherits the nearest theme provider, otherwise light. */
  colorScheme?: import('./theme.js').TungstenColorScheme
  onDiagnostic?: (diagnostic: TungstenDiagnostic) => void
  /** Per-instance presentation language; changing it preserves engine state. */
  language?: string
  schema: TungstenSchema
  initialValues?: TungstenValues | null
  design?: TungstenDesign
  config?: import('../../../api/src/http.js').TungstenConfig
  dataSources?: import('../../../api/src/data-sources.js').DataSources
  /** Exposes reset, value replacement and file preparation for host-owned persistence. */
  onReady?: (controller: import('../../../api/src/engine/client.js').EngineClient) => void
  /** Called after loading and every completed evaluation, including invalid data. */
  onStateChange?: (snapshot: import('../../../api/src/types.js').TungstenSnapshot) => void
  onSave?: import('../../../api/src/operations.js').OperationHandler
  onSubmit?: import('../../../api/src/operations.js').OperationHandler
}
