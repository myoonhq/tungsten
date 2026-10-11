import type { TungstenText } from '../i18n.js'
import type {
  AuthoringCatalog,
  FormState,
  ScalarValue,
  TungstenSchema,
  TungstenValues,
} from '../types.js'

export type Patch =
  | { kind: 'set_value'; key: string; value: ScalarValue }
  | { kind: 'set_hidden'; key: string; hidden: boolean }
  | { kind: 'set_errors'; key: string; errors: string[] }
  | { kind: 'clear_value'; key: string }

export type RepeaterOperation =
  | { kind: 'add'; key: string }
  | { kind: 'remove'; key: string; index: number }
  | { kind: 'reorder'; key: string; from: number; to: number }

export type SourceEffect = {
  id: string
  source: string
  revision: string
  params: Record<string, ScalarValue>
}
export type SourceCommand =
  | { kind: 'resolve'; id: string; revision: string; data: unknown }
  | { kind: 'fail'; id: string; revision: string; message: string }
  | { kind: 'retry'; id: string }
export type IntegrationCommand =
  | { kind: 'source'; command: SourceCommand }
  | {
      kind: 'upload'
      handle: string
      fileId: string
      loading: boolean
      error?: string
      uploaded?: import('../types.js').FileReference
    }
export type IntegrationMetadata = {
  warnings?: import('../i18n.js').TungstenMessage[]
  generation?: string
  revision?: string
  effects?: SourceEffect[]
  handles?: Record<string, string>
}
export type EngineCommand =
  | { kind: 'integrate'; requestId: number; generation: string; command: IntegrationCommand }
  | { kind: 'snapshot'; requestId: number }
  | { kind: 'catalog'; requestId: number }
  | { kind: 'structure'; requestId: number; operation: RepeaterOperation }
  | {
      kind: 'load'
      requestId: number
      schema: TungstenSchema
      initialValues: TungstenValues | null
      preserveState: boolean
      sources?: string[]
      processingLimit?: number
    }
  | {
      kind: 'load_values'
      requestId: number
      initialValues: TungstenValues | null
    }
  | {
      kind: 'patch'
      requestId: number
      patch: Patch
    }
  | {
      kind: 'validate'
      requestId: number
    }

type CommandInput<Command> = Command extends EngineCommand ? Omit<Command, 'requestId'> : never
export type EngineCommandInput = CommandInput<EngineCommand>

export type LoadedResponse = IntegrationMetadata & {
  kind: 'loaded'
  requestId: number
  schema: TungstenSchema
  state: FormState
  valid: boolean
}

export type ValuesLoadedResponse = IntegrationMetadata & {
  kind: 'values_loaded'
  requestId: number
  state: FormState
  valid: boolean
}

export type PatchedResponse = IntegrationMetadata & {
  kind: 'patched'
  requestId: number
  patches: Patch[]
  state: FormState
}

export type ValidatedResponse = IntegrationMetadata & {
  values?: TungstenValues
  kind: 'validated'
  requestId: number
  valid: boolean
  state: FormState
}

export type StructureResponse = IntegrationMetadata & {
  kind: 'structured'
  requestId: number
  state: FormState
  valid: boolean
}

export type CatalogResponse = { kind: 'catalog'; requestId: number; catalog: AuthoringCatalog }

export type EngineSuccessResponse =
  | DeltaResponse
  | SnapshotResponse
  | CatalogResponse
  | StructureResponse
  | LoadedResponse
  | ValuesLoadedResponse
  | PatchedResponse
  | ValidatedResponse

export type EngineResponse =
  | EngineSuccessResponse
  | {
      kind: 'error'
      requestId: number
      message: TungstenText
    }

export type DeltaResponse = IntegrationMetadata & {
  kind: 'delta'
  requestId: number
  fields: FormState['fields']
  baseRevision: string
  generation: string
  revision: string
  patches: Patch[]
}
export type SnapshotResponse = IntegrationMetadata & {
  kind: 'snapshot'
  requestId: number
  state: FormState
}
