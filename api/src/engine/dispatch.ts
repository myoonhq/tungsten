import type { EngineRuntime } from '../wasm/tungsten_core.js'
import type {
  EngineCommand,
  EngineResponse,
  StructureResponse,
  ValidatedResponse,
} from './protocol.js'
import type { AuthoringCatalog, FormState, TungstenSchema } from '../types.js'

type LoadFormPayload = {
  schema: TungstenSchema
  state: FormState
  valid: boolean
}

type ValidateFormPayload = {
  valid: boolean
  state: FormState
}

export function dispatch(runtimeEngine: EngineRuntime, command: EngineCommand): EngineResponse {
  const response = dispatchCommand(runtimeEngine, command)
  const warnings = JSON.parse(runtimeEngine.take_warnings())
  return warnings.length && response.kind !== 'catalog' && response.kind !== 'error'
    ? { ...response, warnings }
    : response
}
function dispatchCommand(runtimeEngine: EngineRuntime, command: EngineCommand): EngineResponse {
  const snapshot = () => JSON.parse(runtimeEngine.integration_snapshot())
  if (command.kind === 'snapshot') {
    return { kind: 'snapshot', requestId: command.requestId, ...snapshot() }
  }
  if (command.kind === 'integrate' || command.kind === 'patch') {
    const payload = JSON.parse(
      command.kind === 'patch'
        ? runtimeEngine.process_patch_delta(JSON.stringify(command.patch))
        : runtimeEngine.integrate(command.generation, JSON.stringify(command.command)),
    )
    return { kind: 'delta', requestId: command.requestId, ...payload }
  }

  if (command.kind === 'catalog') {
    return {
      kind: 'catalog',
      requestId: command.requestId,
      catalog: JSON.parse(runtimeEngine.get_catalog()) as AuthoringCatalog,
    } satisfies EngineResponse
  }

  if (command.kind === 'load') {
    runtimeEngine.set_processing_limit(command.processingLimit ?? 100)
    const payload = JSON.parse(
      runtimeEngine.load_form_integrated(
        JSON.stringify(command.schema),
        JSON.stringify(command.initialValues),
        command.preserveState,
        JSON.stringify(command.sources ?? []),
      ),
    ) as LoadFormPayload

    return {
      kind: 'loaded',
      requestId: command.requestId,
      schema: payload.schema,
      state: payload.state,
      ...JSON.parse(runtimeEngine.integration_metadata()),
      effects: (payload as LoadFormPayload & { effects?: import('./protocol.js').SourceEffect[] })
        .effects,
      valid: payload.valid,
    } satisfies EngineResponse
  }

  if (command.kind === 'load_values') {
    const payload = JSON.parse(
      runtimeEngine.load_values(JSON.stringify(command.initialValues)),
    ) as ValidateFormPayload
    return {
      kind: 'values_loaded',
      requestId: command.requestId,
      valid: payload.valid,
      state: payload.state,
      ...JSON.parse(runtimeEngine.integration_metadata()),
    } satisfies EngineResponse
  }

  if (command.kind === 'structure') {
    const operation = command.operation
    const payload = JSON.parse(
      operation.kind === 'add'
        ? runtimeEngine.add_instance(operation.key)
        : operation.kind === 'remove'
          ? runtimeEngine.remove_instance(operation.key, operation.index)
          : runtimeEngine.reorder_instance(operation.key, operation.from, operation.to),
    ) as Omit<StructureResponse, 'kind' | 'requestId'>
    return {
      kind: 'structured',
      requestId: command.requestId,
      ...payload,
    } satisfies EngineResponse
  }

  const payload = JSON.parse(runtimeEngine.validate_integrated()) as Omit<
    ValidatedResponse,
    'kind' | 'requestId'
  >
  return { kind: 'validated', requestId: command.requestId, ...payload } satisfies EngineResponse
}
