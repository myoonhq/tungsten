import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormOperations, type OperationContext } from './operations.js'
import type { ApiExecutor, TungstenConfig } from './http.js'
function deferred() {
  let resolve!: (value: { data: unknown; status: number }) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<{ data: unknown; status: number }>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const endpoint = { api: 'main', endpoint: 'drafts' }
const config = (request: ApiExecutor, extra: Partial<TungstenConfig> = {}): TungstenConfig => ({
  apis: { main: { baseUrl: 'https://example.com/api/' } },
  request,
  ...extra,
})
const instances: FormOperations[] = []
function make(...args: ConstructorParameters<typeof FormOperations>) {
  const operations = new FormOperations(...args)
  instances.push(operations)
  return operations
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
})
afterEach(() => {
  instances.splice(0).forEach((instance) => instance.close())
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('draft persistence / bounded timing and concurrency', () => {
  it('establishes a baseline then saves only the latest content after the trailing configurable debounce', async () => {
    const request = vi.fn<ApiExecutor>(async () => ({ data: null, status: 204 }))
    const status = vi.fn()
    const operations = make(
      config(request, { autosave: { endpoint, debounceMs: 250 } }),
      {},
      status,
    )
    operations.observe({ text: 'baseline' })
    await vi.advanceTimersByTimeAsync(500)
    expect(request).not.toHaveBeenCalled()
    operations.observe({ text: 'one' })
    await vi.advanceTimersByTimeAsync(200)
    operations.observe({ text: 'two' })
    await vi.advanceTimersByTimeAsync(249)
    expect(request).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    const body = JSON.parse(request.mock.calls[0][0].body as string)
    expect(body).toEqual({
      values: { text: 'two' },
      timestamp: 1700,
      revision: 2,
      writerId: expect.any(String),
    })
    expect(status.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['save', 'dirty'],
      ['save', 'dirty'],
      ['save', 'pending'],
      ['save', 'success'],
    ])
    operations.observe({ text: 'two' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('dispatches N+1 while N is pending; a late success or failure cannot replace the current result', async () => {
    const older = deferred(),
      newer = deferred()
    const request = vi
      .fn<ApiExecutor>()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const status = vi.fn(),
      observer = vi.fn()
    const operations = make(config(request, { autosave: { endpoint } }), { save: observer }, status)
    operations.observe({ text: 'initial' })
    operations.observe({ text: 'older' })
    await vi.advanceTimersByTimeAsync(200)
    operations.observe({ text: 'newer' })
    await vi.advanceTimersByTimeAsync(200)
    expect(request).toHaveBeenCalledTimes(2)
    newer.resolve({ data: null, status: 202 })
    await vi.advanceTimersByTimeAsync(0)
    const count = status.mock.calls.length
    older.reject(new Error('offline'))
    await vi.advanceTimersByTimeAsync(0)
    expect(status).toHaveBeenCalledTimes(count)
    expect(status).toHaveBeenLastCalledWith(
      'save',
      'success',
      expect.objectContaining({ revision: 2 }),
    )
    expect(observer).toHaveBeenCalledWith(
      { text: 'older' },
      expect.objectContaining({ status: 'error', revision: 1, error: expect.any(Error) }),
    )
  })
  it('captures immutable content and metadata before debounce, including invalid/null/false/zero drafts', async () => {
    const save = vi.fn()
    const operations = make({}, { save }, vi.fn())
    operations.observe({ x: 'initial' })
    const values = { x: '', missing: null, boolean: false, number: 0 }
    operations.observe(values)
    values.x = 'mutated'
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledWith(
      { x: '', missing: null, boolean: false, number: 0 },
      expect.objectContaining({ revision: 1, timestamp: 1000, writerId: expect.any(String) }),
    )
    expect(Object.isFrozen(save.mock.calls[0][0])).toBe(true)
  })
  it('host save rejection settles without builtin feedback or unhandled rejections', async () => {
    const status = vi.fn(),
      save = vi.fn(async () => {
        throw new Error('host failed')
      })
    const operations = make({}, { save }, status)
    operations.observe({ x: 'initial' })
    operations.observe({ x: 'edited' })
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(1)
    expect(status).not.toHaveBeenCalled()
  })
  it('prepares browser files and saves a new durable capture, never the obsolete local references', async () => {
    const request = vi.fn<ApiExecutor>(async () => ({ data: null, status: 201 }))
    const prepare = vi.fn(async () => ({
      files: {
        files: [{ id: 'stored', name: 'file', size: 1, mediaType: 'text/plain', uploaded: true }],
      },
    }))
    const operations = make(config(request, { autosave: { endpoint } }), {}, vi.fn(), prepare)
    operations.observe({ files: null })
    operations.observe({
      files: {
        files: [{ id: 'local', name: 'file', size: 1, mediaType: 'text/plain', uploaded: false }],
      },
    })
    await vi.advanceTimersByTimeAsync(200)
    expect(request).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(JSON.parse(request.mock.calls[0][0].body as string).values.files.files[0]).toMatchObject(
      { id: 'stored', uploaded: true },
    )
  })
  it('submission does not stop ongoing autosaves', async () => {
    const request = vi.fn<ApiExecutor>(async () => ({ data: null, status: 204 }))
    const operations = make(
      config(request, { autosave: { endpoint }, submission: { endpoint } }),
      {},
      vi.fn(),
    )
    operations.observe({ x: 'initial' })
    await operations.submit({ x: 'initial' })
    operations.observe({ x: 'later' })
    await vi.advanceTimersByTimeAsync(200)
    expect(request.mock.calls.map(([request]) => request.context.operation)).toEqual([
      'submit',
      'save',
    ])
  })
  it('closing/replacing a form cancels its timer, requests and late UI outcomes', async () => {
    const pending = deferred(),
      status = vi.fn()
    const request = vi.fn<ApiExecutor>(() => pending.promise)
    const operations = make(config(request, { autosave: { endpoint } }), {}, status)
    operations.observe({ x: 'initial' })
    operations.observe({ x: 'first' })
    await vi.advanceTimersByTimeAsync(200)
    operations.observe({ x: 'second' })
    operations.close()
    expect(request.mock.calls[0][0].signal.aborted).toBe(true)
    pending.resolve({ data: null, status: 200 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(request).toHaveBeenCalledTimes(1)
    expect(status).toHaveBeenCalledTimes(3)
  })
  it.each([-1, Infinity, NaN, 0x80000000])('rejects invalid debounce %s', (debounceMs) => {
    expect(() => make({ autosave: { debounceMs } }, {}, vi.fn())).toThrow('tg_api_invalid_debounce')
  })
})
describe('submit endpoint / callback ownership', () => {
  it.each([200, 201, 202, 204, 299])(
    'accepts HTTP %s and calls observer after the attempt',
    async (statusCode) => {
      const request = vi.fn<ApiExecutor>(async () => ({ data: null, status: statusCode })),
        status = vi.fn()
      const callback = vi.fn(async (_values, outcome: OperationContext | undefined) => {
        expect(request).toHaveBeenCalledTimes(1)
        expect(outcome?.status).toBe('success')
      })
      const operations = make(
        config(request, { submission: { endpoint } }),
        { submit: callback },
        status,
      )
      expect((await operations.submit({ x: 'value' })).status).toBe('success')
      expect(callback).toHaveBeenCalledTimes(1)
      expect(status).toHaveBeenLastCalledWith('submit', 'success', expect.anything())
    },
  )
  it.each([400, 401, 409, 422, 500, 503])(
    'passes HTTP %s failure to the observer without field error injection',
    async (code) => {
      const request = vi.fn<ApiExecutor>(async () => ({
          data: { errors: { x: 'server' } },
          status: code,
        })),
        callback = vi.fn(),
        status = vi.fn()
      const operations = make(
        config(request, { submission: { endpoint } }),
        { submit: callback },
        status,
      )
      const outcome = await operations.submit({ x: 'value' })
      expect(outcome.status).toBe('error')
      expect(callback).toHaveBeenCalledWith({ x: 'value' }, outcome)
      expect(status).toHaveBeenLastCalledWith('submit', 'error', outcome)
      expect(Object.isFrozen(outcome)).toBe(true)
    },
  )
  it('an endpoint observer rejection cannot change success, and status can be disabled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const status = vi.fn(),
      request = vi.fn<ApiExecutor>(async () => ({ data: null, status: 200 }))
    const operations = make(
      config(request, { submission: { endpoint, showStatus: false } }),
      {
        submit: async () => {
          throw new Error('observer')
        },
      },
      status,
    )
    expect((await operations.submit({ x: 'value' })).status).toBe('success')
    expect(status).not.toHaveBeenCalled()
  })
  it('without an endpoint the host promise determines the outcome and owns its feedback', async () => {
    const pending = deferred(),
      status = vi.fn(),
      callback = vi.fn(async () => {
        await pending.promise
      })
    const operations = make({}, { submit: callback }, status)
    let settled = false
    const result = operations.submit({ x: 'value' }).then((outcome) => {
      settled = true
      return outcome
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    pending.reject(new Error('host failed'))
    expect((await result).status).toBe('error')
    expect(status).not.toHaveBeenCalled()
  })
})

describe('initial sources and stale file preparation', () => {
  it('initial source completion establishes the baseline but never masks user edits', async () => {
    const save = vi.fn()
    const operations = make({}, { save }, vi.fn())
    operations.observe({ name: null })
    operations.observe({ name: 'Loaded' }, true)
    await vi.advanceTimersByTimeAsync(300)
    expect(save).not.toHaveBeenCalled()
    operations.markEdited()
    operations.observe({ name: 'Edited', other: 'Loaded' }, true)
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledWith(
      { name: 'Edited', other: 'Loaded' },
      expect.objectContaining({ revision: 1 }),
    )
  })
  it('an obsolete file preparation cannot replace or persist a newer content revision', async () => {
    let complete!: (values: { name: string }) => void
    const preparing = new Promise<{ name: string }>((resolve) => {
      complete = resolve
    })
    const request = vi.fn<ApiExecutor>(async () => ({ data: null, status: 204 }))
    const prepare = vi
      .fn()
      .mockReturnValueOnce(preparing)
      .mockImplementation(async (values) => values)
    const operations = make(config(request, { autosave: { endpoint } }), {}, vi.fn(), prepare)
    operations.observe({ name: 'initial' })
    operations.observe({ name: 'older' })
    await vi.advanceTimersByTimeAsync(200)
    operations.observe({ name: 'newer' })
    complete({ name: 'obsolete prepared' })
    await vi.advanceTimersByTimeAsync(200)
    expect(request).toHaveBeenCalledTimes(1)
    expect(JSON.parse(request.mock.calls[0][0].body as string).values).toEqual({ name: 'newer' })
  })
})

describe('immutable engine revisions / deferred payloads', () => {
  it('projects only the settled revision, keeps the edit timestamp, and ignores validation-only updates', async () => {
    const save = vi.fn(),
      initial = vi.fn(() => ({ name: 'initial' })),
      older = vi.fn(() => ({ name: 'older' })),
      latest = vi.fn(() => ({ name: 'latest', empty: null, flag: false }))
    const operations = make({}, { save }, vi.fn())
    operations.observeSnapshot(initial, 0)
    operations.observeSnapshot(older, 1)
    await vi.advanceTimersByTimeAsync(100)
    operations.observeSnapshot(latest, 2)
    operations.observeSnapshot(latest, 2)
    expect(initial).not.toHaveBeenCalled()
    expect(older).not.toHaveBeenCalled()
    expect(latest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(latest).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(
      { name: 'latest', empty: null, flag: false },
      expect.objectContaining({ revision: 2, timestamp: 1100 }),
    )
    expect(Object.isFrozen(save.mock.calls[0][0])).toBe(true)
    operations.observeSnapshot(latest, 2)
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('does no projection when saving is absent or a pending debounce is disposed', async () => {
    const read = vi.fn(() => ({ name: 'never' }))
    const disabled = make({}, {}, vi.fn())
    disabled.observeSnapshot(read, 0)
    disabled.observeSnapshot(read, 1)
    const enabled = make({}, { save: vi.fn() }, vi.fn())
    enabled.observeSnapshot(read, 0)
    enabled.observeSnapshot(read, 1)
    enabled.close()
    await vi.advanceTimersByTimeAsync(1000)
    expect(read).not.toHaveBeenCalled()
  })
})
