import type { ScalarValue } from './types.js'

export type ApiContext = {
  operation: 'source' | 'upload' | 'save' | 'submit' | 'i18n'
  key: string
  idempotencyKey?: string
}
export type ApiDefinition = {
  baseUrl: string
  headers?: HeadersInit | ((context: ApiContext) => HeadersInit | Promise<HeadersInit>)
  credentials?: RequestCredentials
  timeoutMs?: number
}
export type ApiRequest = {
  url: string
  method: string
  headers: Headers
  body?: BodyInit
  credentials: RequestCredentials
  signal: AbortSignal
  context: ApiContext
}
export type ApiResult = { data: unknown; status?: number }
export type ApiExecutor = (request: ApiRequest) => Promise<ApiResult>
export type TungstenConfig = {
  apis?: Readonly<Record<string, ApiDefinition>>
  request?: ApiExecutor
  i18n?: import('./i18n.js').I18nConfig
  /** Finite per-operation core processing budget; default 100. */
  maxProcessingSteps?: number
  /** Warnings log by default; silencing console never suppresses callbacks. */
  warnings?: 'console' | 'silent'
  autosave?: import('./operations.js').AutosaveSettings
  submission?: import('./operations.js').OperationSettings
}
export type Endpoint = {
  api: string
  endpoint: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
}

export class ApiError extends Error {
  readonly messageKey: string
  readonly params?: import('./i18n.js').MessageParameters
  readonly status?: number
  constructor(
    message: string,
    messageKey = message,
    status?: number,
    params?: import('./i18n.js').MessageParameters,
  ) {
    super(
      JSON.stringify({
        messageKey,
        params: { ...params, ...(status === undefined ? {} : { status }) },
      }),
    )
    this.messageKey = messageKey
    this.status = status
    this.params = { ...params, ...(status === undefined ? {} : { status }) }
  }
}

/** Schema endpoints stay beneath the host-configured base path, including credentials. */
export function endpointUrl(baseUrl: string, endpoint: string): URL {
  const base = new URL(baseUrl)
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new ApiError(
      'tg_api_api_baseurl_must_be_an_http_url_without_credentials_query_or_fragment',
      'tg_api_api_baseurl_must_be_an_http_url_without_credentials_query_or_fragment',
      undefined,
      {},
    )
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  if (
    !endpoint ||
    endpoint.startsWith('/') ||
    endpoint.includes('\\') ||
    endpoint.includes('#') ||
    /^[a-z][a-z\d+.-]*:/i.test(endpoint)
  )
    throw new ApiError(
      'tg_api_endpoint_must_be_a_relative_path_beneath_baseurl',
      'tg_api_endpoint_must_be_a_relative_path_beneath_baseurl',
      undefined,
      {},
    )
  for (const segment of endpoint.split('?')[0].split('/')) {
    let decoded = segment
    for (let i = 0; i < 4; i += 1) {
      const next = decodeURIComponent(decoded)
      if (next === '..' || next === '.' || /[\\/]/.test(next))
        throw new ApiError(
          'tg_api_endpoint_cannot_escape_baseurl',
          'tg_api_endpoint_cannot_escape_baseurl',
          undefined,
          {},
        )
      if (next === decoded) break
      decoded = next
    }
    if (decoded.includes('%'))
      throw new ApiError(
        'tg_api_endpoint_contains_excessive_encoding',
        'tg_api_endpoint_contains_excessive_encoding',
        undefined,
        {},
      )
  }
  const url = new URL(endpoint, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    throw new ApiError(
      'tg_api_endpoint_cannot_escape_baseurl',
      'tg_api_endpoint_cannot_escape_baseurl',
      undefined,
      {},
    )
  return url
}

export const fetchExecutor: ApiExecutor = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    credentials: request.credentials,
    signal: request.signal,
    redirect: 'error',
  })
  if (!response.ok) throw new ApiError('tg_api_http_error', 'tg_api_http_error', response.status)
  const data =
    response.status === 204
      ? null
      : /json/i.test(response.headers.get('content-type') ?? '')
        ? await response.json()
        : await response.text()
  return { data, status: response.status }
}

export class ApiClient {
  private readonly config: TungstenConfig
  constructor(config: TungstenConfig = {}) {
    this.config = config
  }
  async request(
    endpoint: Endpoint,
    context: ApiContext,
    options: { signal?: AbortSignal; params?: Record<string, ScalarValue>; body?: unknown } = {},
  ): Promise<unknown> {
    const definition = Object.hasOwn(this.config.apis ?? {}, endpoint.api)
      ? this.config.apis?.[endpoint.api]
      : undefined
    if (!definition)
      throw new ApiError(
        'tg_api_api_is_not_configured',
        'tg_api_api_is_not_configured',
        undefined,
        { p0: endpoint.api },
      )
    const url = endpointUrl(definition.baseUrl, endpoint.endpoint)
    const timeout = definition.timeoutMs ?? 30_000
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new ApiError(
        'tg_api_api_timeoutms_must_be_finite_and_positive',
        'tg_api_api_timeoutms_must_be_finite_and_positive',
        undefined,
        {},
      )
    const controller = new AbortController()
    const abort = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(
      () => controller.abort(new ApiError('tg_api_timeout', 'tg_api_timeout', undefined, {})),
      timeout,
    )
    let rejectAbort!: (reason: unknown) => void
    const canceled = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    const onAbort = () =>
      rejectAbort(
        controller.signal.reason ??
          new ApiError('tg_api_canceled', 'tg_api_canceled', undefined, {}),
      )
    controller.signal.addEventListener('abort', onAbort, { once: true })
    try {
      controller.signal.throwIfAborted()
      const work = async () => {
        const headers = new Headers(
          typeof definition.headers === 'function'
            ? await definition.headers(context)
            : definition.headers,
        )
        controller.signal.throwIfAborted()
        const method = endpoint.method ?? 'GET'
        let body: BodyInit | undefined
        if (method === 'GET') {
          if (options.body !== undefined)
            throw new ApiError(
              'tg_api_get_requests_cannot_have_a_body',
              'tg_api_get_requests_cannot_have_a_body',
              undefined,
              {},
            )
          for (const [key, value] of Object.entries(options.params ?? {})) {
            if (value !== null) {
              if (typeof value === 'object')
                throw new ApiError(
                  'tg_api_query_parameters_must_be_scalar_values',
                  'tg_api_query_parameters_must_be_scalar_values',
                  undefined,
                  {},
                )
              url.searchParams.set(key, String(value))
            }
          }
        } else if (options.body instanceof FormData) {
          body = options.body
          headers.delete('Content-Type')
        } else if (options.body !== undefined || options.params) {
          body = JSON.stringify(options.body ?? options.params)
          if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
        }
        const result = await (this.config.request ?? fetchExecutor)({
          url: url.href,
          method,
          headers,
          body,
          credentials: definition.credentials ?? 'omit',
          signal: controller.signal,
          context,
        })
        controller.signal.throwIfAborted()
        if (result.status !== undefined && (result.status < 200 || result.status >= 300))
          throw new ApiError('tg_api_http_error', 'tg_api_http_error', result.status)
        return result.data
      }
      return await Promise.race([work(), canceled])
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }
}

export function jsonPointer(body: unknown, pointer = ''): unknown {
  if (!pointer) return body
  if (!pointer.startsWith('/'))
    throw new ApiError(
      'tg_api_result_path_must_be_a_json_pointer',
      'tg_api_result_path_must_be_a_json_pointer',
      undefined,
      {},
    )
  let value = body
  for (const part of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(part))
      throw new ApiError(
        'tg_api_invalid_json_pointer_escape',
        'tg_api_invalid_json_pointer_escape',
        undefined,
        {},
      )
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))
      throw new ApiError('tg_api_missing_result_path', 'tg_api_missing_result_path', undefined, {
        p0: pointer,
      })
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new ApiError('tg_api_missing_result_path', 'tg_api_missing_result_path', undefined, {
        p0: pointer,
      })
    value = (value as Record<string, unknown>)[key]
  }
  return value
}
