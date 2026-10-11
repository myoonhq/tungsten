import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from './http.js'
import {
  checkResponseSchema,
  fetchSource,
  validateResponse,
  type ResponseSchema,
  type DataSource,
} from './data-sources.js'

const effect = { id: 'source-id', source: 'countries', revision: '7', params: { country: 'SK' } }
const definition = {
  api: 'main',
  endpoint: 'countries',
  resultPath: '/data',
  schema: {
    type: 'array',
    items: {
      type: 'object',
      properties: { value: { type: 'string' }, label: { type: 'string' } },
      required: ['value', 'label'],
      additionalProperties: false,
    },
  },
} satisfies DataSource

describe('datasource response contract', () => {
  it.each([
    ['string', 'text', 42],
    ['number', 1.5, Infinity],
    ['integer', 1, 1.5],
    ['boolean', false, 'false'],
    ['null', null, 'null'],
  ])('validates %s without coercion or rejecting falsy values', (type, valid, invalid) => {
    const schema = { type } as ResponseSchema
    expect(() => validateResponse(valid, schema)).not.toThrow()
    expect(() => validateResponse(invalid, schema)).toThrow()
  })
  it('extracts nested arrays, maps then validates before delivering data', async () => {
    const request = vi.fn<import('./http.js').ApiExecutor>(async () => ({
      status: 200,
      data: { data: [{ id: 'SK', name: 'Slovakia' }] },
    }))
    const api = new ApiClient({ apis: { main: { baseUrl: 'https://example.com/' } }, request })
    const result = await fetchSource(
      api,
      {
        ...definition,
        map: (data) =>
          (data as { id: string; name: string }[]).map((row) => ({
            value: row.id,
            label: row.name,
          })),
      },
      effect,
      new AbortController().signal,
    )
    expect(result).toEqual([{ value: 'SK', label: 'Slovakia' }])
    expect(request).toHaveBeenCalledTimes(1)
    expect(new URL(request.mock.calls[0][0].url).searchParams.get('country')).toBe('SK')
  })
  it.each([
    { data: [{ value: 'SK' }] },
    { data: [{ value: 1, label: 'Slovakia' }] },
    { data: [{ value: 'SK', label: 'Slovakia', secret: 1 }] },
    { wrong: [] },
  ])('rejects malformed extraction/schema results %#', async (data) => {
    const api = new ApiClient({
      apis: { main: { baseUrl: 'https://example.com/' } },
      request: async () => ({ data }),
    })
    await expect(
      fetchSource(api, definition, effect, new AbortController().signal),
    ).rejects.toThrow()
  })
  it('does not accept inherited required properties or unsafe integer values', () => {
    expect(() =>
      validateResponse(Object.create({ value: 'SK' }), { type: 'object', required: ['value'] }),
    ).toThrow()
    expect(() => validateResponse(Number.MAX_SAFE_INTEGER + 1, { type: 'integer' })).toThrow()
  })
  it('bounds nested schema and response traversal', () => {
    let schema: ResponseSchema = { type: 'string' }
    let data: unknown = 'value'
    for (let i = 0; i < 66; i++) {
      schema = { type: 'array', items: schema }
      data = [data]
    }
    expect(() => checkResponseSchema(schema)).toThrow()
    expect(() => validateResponse(data, schema)).toThrow()
  })
  it('unsupported schema keywords fail explicitly', () => {
    expect(() =>
      checkResponseSchema({ type: 'string', pattern: 'x' } as unknown as ResponseSchema),
    ).toThrow()
  })
})
