import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError, endpointUrl, jsonPointer } from './http.js'
import { checkResponseSchema, validateResponse } from './data-sources.js'

describe('API boundary', () => {
  it('confines endpoints to the configured origin and path', () => {
    expect(endpointUrl('https://example.com/api/v1', 'choices?x=y').href).toBe(
      'https://example.com/api/v1/choices?x=y',
    )
    for (const path of [
      '../secret',
      '/secret',
      '//evil.test',
      'https://evil.test',
      '%2e%2e/secret',
      '%252e%252e/secret',
      'a%2fb',
      'a\\b',
      'a#secret',
    ])
      expect(() => endpointUrl('https://example.com/api/', path)).toThrow()
  })
  it('normalizes named API headers, credentials, query parameters and custom execution', async () => {
    const request = vi.fn(async () => ({ data: { ok: true }, status: 200 }))
    const api = new ApiClient({
      apis: {
        main: {
          baseUrl: 'https://example.com/api',
          headers: () => ({ Authorization: 'test' }),
          credentials: 'include',
        },
      },
      request,
    })
    expect(
      await api.request(
        { api: 'main', endpoint: 'choices' },
        { operation: 'source', key: 'choices' },
        { params: { page: 2, enabled: false, skip: null } },
      ),
    ).toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/api/choices?page=2&enabled=false',
        credentials: 'include',
        method: 'GET',
      }),
    )
    expect(request.mock.calls[0][0].headers.get('authorization')).toBe('test')
    await expect(
      api.request({ api: 'missing', endpoint: 'choices' }, { operation: 'source', key: 'choices' }),
    ).rejects.toThrow(ApiError)
  })
  it('lets the browser create multipart boundaries and rejects custom HTTP failures', async () => {
    const request = vi.fn(async () => ({ data: null, status: 500 }))
    const api = new ApiClient({
      apis: {
        main: { baseUrl: 'https://example.com', headers: { 'Content-Type': 'application/json' } },
      },
      request,
    })
    const body = new FormData()
    body.append('file', new File(['hello'], 'hello.txt'))
    await expect(
      api.request(
        { api: 'main', endpoint: 'files', method: 'POST' },
        { operation: 'upload', key: 'file' },
        { body },
      ),
    ).rejects.toMatchObject({ messageKey: 'tg_api_http_error', status: 500 })
    expect(request.mock.calls[0][0].headers.has('content-type')).toBe(false)
    expect(request.mock.calls[0][0].body).toBe(body)
  })
  it('times out and cancels even an override which ignores abort signals', async () => {
    const api = new ApiClient({
      apis: { main: { baseUrl: 'https://example.com', timeoutMs: 10 } },
      request: () => new Promise(() => {}),
    })
    await expect(
      api.request({ api: 'main', endpoint: 'data' }, { operation: 'source', key: 'x' }),
    ).rejects.toMatchObject({ messageKey: 'tg_api_timeout' })
    const controller = new AbortController()
    const pending = api.request(
      { api: 'main', endpoint: 'data' },
      { operation: 'source', key: 'x' },
      { signal: controller.signal },
    )
    controller.abort(new Error('Canceled by host'))
    await expect(pending).rejects.toThrow('Canceled by host')
  })
})
describe('source response contract', () => {
  it('extracts nested arrays using JSON Pointer and rejects missing/invalid paths', () => {
    const body = { data: [{ 'a/b': { '~key': 'yes' } }] }
    expect(jsonPointer(body, '/data/0/a~1b/~0key')).toBe('yes')
    expect(jsonPointer(body)).toBe(body)
    for (const path of ['/missing', '/data/01', '/data/0/~2'])
      expect(() => jsonPointer(body, path)).toThrow()
  })
  it('validates arrays and nested objects and rejects unsupported schemas', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { value: { type: 'string' }, label: { type: 'string' } },
        required: ['value', 'label'],
        additionalProperties: false,
      },
    } as const
    checkResponseSchema(schema as never)
    expect(() => validateResponse([{ value: 'one', label: 'One' }], schema as never)).not.toThrow()
    expect(() => validateResponse([{ value: 1, label: 'One' }], schema as never)).toThrow()
    expect(() => validateResponse([{ value: 'one' }], schema as never)).toThrow()
    expect(() =>
      validateResponse([{ value: 'one', label: 'One', extra: true }], schema as never),
    ).toThrow()
    expect(() => checkResponseSchema({ type: 'array' } as never)).toThrow()
    expect(() => checkResponseSchema({ type: 'string', pattern: 'x' } as never)).toThrow()
  })
})
