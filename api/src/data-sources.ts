import { ApiClient, ApiError, jsonPointer, type Endpoint } from './http.js'
import type { SourceEffect } from './engine/protocol.js'

export type ResponseSchema =
  | { type: 'string' | 'number' | 'integer' | 'boolean' | 'null' }
  | { type: 'array'; items: ResponseSchema }
  | {
      type: 'object'
      properties?: Record<string, ResponseSchema>
      required?: string[]
      additionalProperties?: boolean
    }
export type DataSource = Endpoint & {
  resultPath?: string
  schema?: ResponseSchema
  map?: (value: unknown) => unknown
}
export type DataSources = Readonly<Record<string, DataSource>>

/** A deliberately bounded JSON Schema subset, applied after extraction/mapping. */
export function validateResponse(
  value: unknown,
  schema: ResponseSchema,
  path = '',
  depth = 0,
): void {
  if (depth > 64)
    throw new ApiError(
      'tg_source_response_exceeds_the_supported_nesting_depth',
      'tg_source_response_exceeds_the_supported_nesting_depth',
      undefined,
      {},
    )
  const fail = () => {
    throw new ApiError(
      'tg_source_invalid_source_response_at_expected',
      'tg_source_invalid_source_response_at_expected',
      undefined,
      { p0: path || '/', p1: schema.type },
    )
  }
  switch (schema.type) {
    case 'null':
      if (value !== null) fail()
      break
    case 'string':
      if (typeof value !== 'string') fail()
      break
    case 'boolean':
      if (typeof value !== 'boolean') fail()
      break
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail()
      break
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail()
      break
    case 'array':
      if (!Array.isArray(value)) {
        fail()
        break
      }
      value.forEach((item, index) =>
        validateResponse(item, schema.items, `${path}/${index}`, depth + 1),
      )
      break
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail()
        break
      }
      for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail()
      for (const [key, item] of Object.entries(value)) {
        const child = Object.hasOwn(schema.properties ?? {}, key)
          ? schema.properties?.[key]
          : undefined
        if (child) validateResponse(item, child, `${path}/${key}`, depth + 1)
        else if (schema.additionalProperties === false) fail()
      }
      break
    }
    default:
      throw new ApiError(
        'tg_source_unsupported_response_schema_type',
        'tg_source_unsupported_response_schema_type',
        undefined,
        {},
      )
  }
}
export function checkResponseSchema(schema: ResponseSchema, depth = 0): void {
  if (!schema || depth > 64 || typeof schema !== 'object')
    throw new ApiError(
      'tg_source_invalid_response_schema',
      'tg_source_invalid_response_schema',
      undefined,
      {},
    )
  const allowed =
    schema.type === 'array'
      ? ['type', 'items']
      : schema.type === 'object'
        ? ['type', 'properties', 'required', 'additionalProperties']
        : ['type']
  if (
    !['string', 'number', 'integer', 'boolean', 'null', 'array', 'object'].includes(schema.type) ||
    Object.keys(schema).some((key) => !allowed.includes(key))
  )
    throw new ApiError(
      'tg_source_unsupported_response_schema_keyword',
      'tg_source_unsupported_response_schema_keyword',
      undefined,
      {},
    )
  if (schema.type === 'array') checkResponseSchema(schema.items, depth + 1)
  if (schema.type === 'object') {
    if (
      schema.properties !== undefined &&
      (!schema.properties ||
        typeof schema.properties !== 'object' ||
        Array.isArray(schema.properties))
    )
      throw new ApiError(
        'tg_source_invalid_object_properties',
        'tg_source_invalid_object_properties',
        undefined,
        {},
      )
    if (
      schema.required !== undefined &&
      (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string'))
    )
      throw new ApiError(
        'tg_source_invalid_required_properties',
        'tg_source_invalid_required_properties',
        undefined,
        {},
      )
    if (
      schema.additionalProperties !== undefined &&
      typeof schema.additionalProperties !== 'boolean'
    )
      throw new ApiError(
        'tg_source_invalid_additionalproperties',
        'tg_source_invalid_additionalproperties',
        undefined,
        {},
      )
    for (const child of Object.values(schema.properties ?? {}))
      checkResponseSchema(child, depth + 1)
  }
}
export async function fetchSource(
  api: ApiClient,
  definition: DataSource,
  effect: SourceEffect,
  signal: AbortSignal,
): Promise<unknown> {
  let data = jsonPointer(
    await api.request(
      definition,
      { operation: 'source', key: effect.source },
      { params: effect.params, signal },
    ),
    definition.resultPath,
  )
  if (definition.map) data = definition.map(data)
  if (definition.schema) validateResponse(data, definition.schema)
  // Core independently normalizes every bound value/options response.
  return data
}
