import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError, type ApiExecutor, type ApiRequest } from './http.js'

const endpoint = { api: 'main', endpoint: 'cities' }
const context = { operation: 'source' as const, key: 'cities' }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function client(request?: ApiExecutor, timeoutMs = 100) {
  return new ApiClient({
    apis: { main: { baseUrl: 'https://example.com/api/', timeoutMs } },
    request,
  })
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('API network lifecycle', () => {
  it('reports an offline fetch, never replays it automatically, and succeeds on explicit retry', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ ready: true }))
    vi.stubGlobal('fetch', fetch)
    const api = client()
    await expect(api.request(endpoint, context)).rejects.toThrow('Failed to fetch')
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(500)
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(api.request(endpoint, context)).resolves.toEqual({ ready: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates connection loss during an active fetch and clears its deadline', async () => {
    const transport = deferred<Response>()
    const fetch = vi.fn(() => transport.promise)
    vi.stubGlobal('fetch', fetch)
    const pending = client().request(endpoint, context)
    const failed = expect(pending).rejects.toThrow('Connection reset')
    await vi.advanceTimersByTimeAsync(40)
    transport.reject(new TypeError('Connection reset'))
    await failed
    expect(vi.getTimerCount()).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('accepts a pending request that resumes after connectivity returns before its deadline', async () => {
    const transport = deferred<Response>()
    const fetch = vi.fn(() => transport.promise)
    vi.stubGlobal('fetch', fetch)
    const pending = client().request(endpoint, context)
    await vi.advanceTimersByTimeAsync(30)
    window.dispatchEvent(new Event('offline'))
    await vi.advanceTimersByTimeAsync(40)
    window.dispatchEvent(new Event('online'))
    transport.resolve(json({ recovered: true }))
    await expect(pending).resolves.toEqual({ recovered: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a slow request pending, then accepts completion just before the timeout', async () => {
    const transport = deferred<{ data: unknown }>()
    const settled = vi.fn()
    const pending = client(() => transport.promise).request(endpoint, context)
    void pending.then(settled)
    await vi.advanceTimersByTimeAsync(99)
    expect(settled).not.toHaveBeenCalled()
    transport.resolve({ data: 'ready' })
    await expect(pending).resolves.toBe('ready')
    await vi.advanceTimersByTimeAsync(200)
    expect(settled).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['resolve', 'reject'] as const)(
    'does not revive a timed-out request when an abort-ignoring transport later %ss',
    async (outcome) => {
      const transport = deferred<{ data: unknown }>()
      let request!: ApiRequest
      const executor = vi.fn((input: ApiRequest) => {
        request = input
        return transport.promise
      })
      const pending = client(executor).request(endpoint, context)
      const failed = expect(pending).rejects.toMatchObject({ messageKey: 'tg_api_timeout' })
      await vi.advanceTimersByTimeAsync(100)
      await failed
      expect(request.signal.aborted).toBe(true)
      if (outcome === 'resolve') transport.resolve({ data: 'too late' })
      else transport.reject(new TypeError('Late network failure'))
      await vi.advanceTimersByTimeAsync(0)
      expect(executor).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('detects a connection lost while reading the response body after headers arrived', async () => {
    const body = deferred<unknown>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => body.promise,
      })),
    )
    const pending = client().request(endpoint, context)
    const failed = expect(pending).rejects.toThrow('Body interrupted')
    await vi.advanceTimersByTimeAsync(25)
    body.reject(new TypeError('Body interrupted'))
    await failed
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies the deadline to response-body decoding and ignores a late body', async () => {
    const body = deferred<unknown>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => body.promise,
      })),
    )
    const pending = client().request(endpoint, context)
    const failed = expect(pending).rejects.toMatchObject({ messageKey: 'tg_api_timeout' })
    await vi.advanceTimersByTimeAsync(100)
    await failed
    body.resolve({ stale: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a slow request without canceling a concurrent request, and removes abort listeners', async () => {
    const first = deferred<{ data: unknown }>(),
      second = deferred<{ data: unknown }>()
    const executor = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const api = client(executor),
      controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const a = api.request(endpoint, context, { signal: controller.signal }),
      b = api.request(endpoint, context)
    const canceled = expect(a).rejects.toThrow('Host canceled')
    controller.abort(new Error('Host canceled'))
    await canceled
    second.resolve({ data: 'second' })
    await expect(b).resolves.toBe('second')
    expect(executor.mock.calls[0][0].signal.aborted).toBe(true)
    expect(executor.mock.calls[1][0].signal.aborted).toBe(false)
    first.resolve({ data: 'stale' })
    await vi.advanceTimersByTimeAsync(0)
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not obtain headers or start a transport for a pre-canceled request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Already canceled'))
    const headers = vi.fn(() => ({})),
      request = vi.fn(async () => ({ data: 'wrong' }))
    const api = new ApiClient({
      apis: { main: { baseUrl: 'https://example.com/', headers } },
      request,
    })
    await expect(api.request(endpoint, context, { signal: controller.signal })).rejects.toThrow(
      'Already canceled',
    )
    expect(headers).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['timeout', 'cancel'] as const)(
    'stops before fetching if asynchronous headers %s, even when headers later resolve',
    async (reason) => {
      const headers = deferred<Record<string, string>>(),
        controller = new AbortController()
      const request = vi.fn(async () => ({ data: 'wrong' }))
      const api = new ApiClient({
        apis: {
          main: { baseUrl: 'https://example.com/', timeoutMs: 100, headers: () => headers.promise },
        },
        request,
      })
      const pending = api.request(endpoint, context, { signal: controller.signal })
      const failed = expect(pending).rejects.toMatchObject(
        reason === 'timeout' ? { messageKey: 'tg_api_timeout' } : { message: 'Host canceled' },
      )
      if (reason === 'timeout') await vi.advanceTimersByTimeAsync(100)
      else controller.abort(new Error('Host canceled'))
      await failed
      headers.resolve({ Authorization: 'test-token' })
      await vi.advanceTimersByTimeAsync(0)
      expect(request).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('rejects transient HTTP errors without automatic replay and can explicitly retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'unavailable' }, 503))
      .mockResolvedValueOnce(json({ ready: true }))
    vi.stubGlobal('fetch', fetch)
    const api = client()
    await expect(api.request(endpoint, context)).rejects.toMatchObject({
      status: 503,
      messageKey: 'tg_api_http_error',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(api.request(endpoint, context)).resolves.toEqual({ ready: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a malformed response rather than treating it as a successful empty result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
      ),
    )
    await expect(client().request(endpoint, context)).rejects.toThrow(SyntaxError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors cancellation even if the transport resolves in the same turn', async () => {
    const controller = new AbortController()
    const api = client(async () => {
      controller.abort(new ApiError('Canceled', 'tg_api_canceled'))
      return { data: 'stale' }
    })
    await expect(
      api.request(endpoint, context, { signal: controller.signal }),
    ).rejects.toMatchObject({ messageKey: 'tg_api_canceled' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
