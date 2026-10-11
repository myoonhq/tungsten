import { dateDisplayValue } from '../../../api/src/date.js'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { EngineRuntime, initSync } from '../../../api/src/wasm/tungsten_core.js'
import { dispatch } from '../../../api/src/engine/dispatch.js'
import { EngineClient } from '../../../api/src/engine/client.js'
import type { EngineCommand } from '../../../api/src/engine/protocol.js'
import type { TungstenField, TungstenSchema, TungstenValues } from '../../../api/src/types.js'
import type { ApiRequest, TungstenConfig } from '../../../api/src/http.js'
import { Tungsten } from './Tungsten.js'

const transport = vi.hoisted(() => ({
  corrupt: false,
  crash: false,
  responses: [] as { kind: string; [key: string]: unknown }[],
}))
beforeEach(() => {
  transport.corrupt = false
  transport.crash = false
  transport.responses = []
})

// Exercise the production dispatcher/client/React/core with an in-process worker transport.
vi.mock('../../../api/src/engine/engine.worker?worker', () => ({
  default: class {
    runtime = new EngineRuntime()
    onmessage?: (event: { data: unknown }) => void
    onerror?: (event: unknown) => void
    stopped = false
    queue = Promise.resolve()
    postMessage(command: EngineCommand) {
      this.queue = this.queue.then(() => {
        if (this.stopped) return
        if (transport.crash) {
          transport.crash = false
          this.onerror?.({ message: 'tg_api_worker_failed' })
          return
        }
        try {
          const response = structuredClone(dispatch(this.runtime, structuredClone(command)))
          if (response.kind === 'delta' && transport.corrupt) {
            response.baseRevision = 'invalid'
            transport.corrupt = false
          }
          transport.responses.push(response)
          this.onmessage?.({ data: response })
        } catch (error) {
          this.onmessage?.({
            data: { kind: 'error', requestId: command.requestId, message: String(error) },
          })
        }
      })
    }
    terminate() {
      this.stopped = true
      this.runtime.free()
    }
  },
}))
beforeAll(() => {
  initSync({ module: readFileSync('api/src/wasm/tungsten_core_bg.wasm') })
})
const clients: EngineClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.destroy())
})
function client(config: TungstenConfig = {}) {
  const c = new EngineClient()
  clients.push(c)
  c.configure(config)
  return c
}
function config(request: (request: ApiRequest) => Promise<{ data: unknown }>): TungstenConfig {
  return { apis: { main: { baseUrl: 'https://example.com/api/' } }, request }
}
function fileSchema(timing: 'submit' | 'selection' = 'submit'): TungstenSchema {
  return {
    schemaVersion: 'sprout',
    form: [
      {
        type: 'file',
        key: 'attachment',
        view: { label: 'Attachment' },
        upload: { api: 'main', endpoint: 'files', timing },
        validators: [{ kind: 'required' }],
      },
    ],
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('real React/client/WASM integration', () => {
  it('loads, edits, validates and submits all temporal modes through the real core', async () => {
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        { type: 'date', key: 'day', view: { label: 'Day' }, validators: [{ kind: 'required' }] },
        { type: 'date', key: 'opening', mode: 'time', view: { label: 'Opening' } },
        {
          type: 'date',
          key: 'meeting',
          mode: 'datetime',
          timeZone: 'Europe/Bratislava',
          view: { label: 'Meeting' },
          validators: [{ kind: 'required' }, { kind: 'min', value: '2026-01-01T00:00:00Z' }],
        },
        {
          type: 'text',
          key: 'status',
          view: { label: 'Status' },
          rules: [
            {
              when: { property: 'meeting', operation: 'Eq', value: '2026-10-07T10:30:00+02:00' },
              then: [{ kind: 'set_value', value: 'Matched instant' }],
            },
          ],
        },
      ],
    }
    const onSubmit = vi.fn()
    const saved = { day: '2024-02-29', opening: '09:30', meeting: '2026-10-07T09:30:00+02:00' }
    const view = render(<Tungsten schema={schema} initialValues={saved} onSubmit={onSubmit} />)
    const meeting = await screen.findByLabelText(/^Meeting/)
    expect(meeting).toHaveValue(
      dateDisplayValue(
        '2026-10-07T07:30:00Z',
        { mode: 'datetime', timeZone: 'Europe/Bratislava' },
        'en',
      ),
    )
    expect(screen.getByLabelText(/^Day/)).toHaveValue(
      dateDisplayValue('2024-02-29', { mode: 'date' }, 'en'),
    )
    expect(screen.getByLabelText('Opening')).toHaveValue(
      dateDisplayValue('09:30:00', { mode: 'time' }, 'en'),
    )
    fireEvent.change(meeting, { target: { value: '2026-03-29T02:30' } })
    await waitFor(() => expect(screen.getByText(/Enter a valid MM\/DD\/YYYY/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(meeting).toHaveAttribute('aria-invalid', 'true'))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(meeting, { target: { value: '2026-10-07T10:30' } })
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('Matched instant'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        day: '2024-02-29',
        opening: '09:30:00',
        meeting: '2026-10-07T08:30:00Z',
        status: 'Matched instant',
      }),
    )
    view.rerender(
      <Tungsten
        schema={schema}
        initialValues={{ ...saved, meeting: '2026-10-25T01:30:00Z' }}
        onSubmit={onSubmit}
      />,
    )
    await waitFor(() =>
      expect(screen.getByLabelText(/^Meeting/)).toHaveValue(
        dateDisplayValue(
          '2026-10-25T02:30',
          { mode: 'datetime', timeZone: 'Europe/Bratislava' },
          'en',
        ),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenLastCalledWith({
        day: '2024-02-29',
        opening: '09:30:00',
        meeting: '2026-10-25T01:30:00Z',
        status: null,
      }),
    )
  })

  it('loads async datetime values before applying instant comparisons and rejects unavailable timezone config', async () => {
    const ready = deferred<{ data: unknown }>()
    const c = client()
    c.configure(
      config(() => ready.promise),
      { meeting: { api: 'main', endpoint: 'meeting' } },
    )
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'date',
          key: 'meeting',
          mode: 'datetime',
          timeZone: 'UTC',
          bindings: { value: { source: 'meeting' } },
        },
        {
          type: 'boolean',
          key: 'ready',
          rules: [
            {
              when: { property: 'meeting', operation: 'GEqt', value: '2026-10-07T08:00:00Z' },
              then: [{ kind: 'set_value', value: true }],
            },
          ],
        },
      ],
    }
    await c.load(schema)
    expect((await c.validate()).values?.ready).toBeNull()
    ready.resolve({ data: '2026-10-07T10:30:00+02:00' })
    await waitFor(async () => expect((await c.validate()).values?.ready).toBe(true))
    expect((await c.validate()).values?.meeting).toBe('2026-10-07T08:30:00Z')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      c.load({
        schemaVersion: 'sprout',
        form: [{ type: 'date', key: 'when', mode: 'datetime', timeZone: 'Missing/Zone' }],
      }),
    ).rejects.toThrow(/tg_api_field_has_an_unknown_timezone/)
    expect(error).toHaveBeenCalledExactlyOnceWith({
      messageKey: 'tg_api_field_has_an_unknown_timezone',
      params: { p0: 'when', p1: 'Missing/Zone' },
    })
    error.mockRestore()
    expect((await c.validate()).values?.ready).toBe(true)
  })

  it.each([false, true])(
    'preserves a non-first saved selection while fetching fresh draft data (selectFirstOption=%s)',
    async (selectFirstOption) => {
      const fresh = deferred<{ data: unknown }>(),
        changed = deferred<{ data: unknown }>()
      const request = vi
        .fn()
        .mockReturnValueOnce(fresh.promise)
        .mockReturnValueOnce(changed.promise)
        .mockResolvedValueOnce({
          data: [
            { value: 'KE', label: 'Košice' },
            { value: 'BA', label: 'Bratislava' },
          ],
        })
      const c = client()
      c.configure(config(request), { cities: { api: 'main', endpoint: 'cities' } })
      const schema: TungstenSchema = {
        schemaVersion: 'sprout',
        form: [
          { type: 'text', key: 'country', current_value: 'SK' },
          {
            type: 'select',
            key: 'city',
            selectFirstOption,
            bindings: { options: { source: 'cities', params: { country: { ref: 'country' } } } },
          },
        ],
      }
      await c.load(schema, { country: 'CZ', city: 'BR' })
      expect((await c.validate()).values).toEqual({ country: 'CZ', city: 'BR' })
      expect(request.mock.calls[0][0].url).toContain('country=CZ')
      fresh.resolve({
        data: [
          { value: 'PR', label: 'Prague' },
          { value: 'BR', label: 'Brno' },
        ],
      })
      await waitFor(async () => expect((await c.validate()).valid).toBe(true))
      expect((await c.validate()).values!.city).toBe('BR')
      await c.patch({ kind: 'set_value', key: 'country', value: 'SK' })
      expect((await c.validate()).values!.city).toBe('BR')
      changed.resolve({
        data: [
          { value: 'BA', label: 'Bratislava' },
          { value: 'KE', label: 'Košice' },
        ],
      })
      await waitFor(async () => expect((await c.validate()).valid).toBe(true))
      const saved = (await c.validate()).values!
      expect(saved.city).toBe(selectFirstOption ? 'BA' : null)
      await c.load(schema, saved)
      await waitFor(async () => expect((await c.validate()).valid).toBe(true))
      expect((await c.validate()).values).toEqual(saved)
    },
  )

  it('selects the first ready option in React, applies rules, and preserves a valid non-first choice on refresh', async () => {
    const first = deferred<{ data: unknown }>(),
      next = deferred<{ data: unknown }>()
    const request = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
    const onSubmit = vi.fn()
    render(
      <Tungsten
        schema={{
          schemaVersion: 'sprout',
          form: [
            { type: 'text', key: 'scope', view: { label: 'Scope' }, current_value: 'initial' },
            {
              type: 'select',
              key: 'city',
              view: { label: 'City' },
              selectFirstOption: true,
              bindings: { options: { source: 'cities', params: { scope: { ref: 'scope' } } } },
            },
            {
              type: 'text',
              key: 'status',
              view: { label: 'Status' },
              rules: [
                {
                  when: { property: 'city', operation: 'Eq', value: 'BA' },
                  then: [{ kind: 'set_value', value: 'First selected' }],
                },
              ],
            },
          ],
        }}
        config={config(request)}
        dataSources={{ cities: { api: 'main', endpoint: 'cities' } }}
        onSubmit={onSubmit}
      />,
    )
    const city = await screen.findByRole('combobox', { name: 'City' })
    expect(city).toBeDisabled()
    expect(screen.getByLabelText('Status')).toHaveValue('')
    first.resolve({
      data: [
        { value: 'BA', label: 'Bratislava' },
        { value: 'KE', label: 'Košice' },
      ],
    })
    await waitFor(() => expect(city).toHaveTextContent('Bratislava'))
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('First selected'))
    fireEvent.click(city)
    fireEvent.click(screen.getByRole('option', { name: 'Košice' }))
    await waitFor(() => expect(city).toHaveTextContent('Košice'))
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'new' } })
    next.resolve({
      data: [
        { value: 'BA', label: 'New Bratislava' },
        { value: 'KE', label: 'New Košice' },
      ],
    })
    await waitFor(() => expect(city).toHaveTextContent('New Košice'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ scope: 'new', city: 'KE', status: 'First selected' }),
    )
  })

  it('loads /data/0/value through a value datasource and lets valid draft values override it', async () => {
    const c = client()
    const request = vi.fn(async () => ({
      data: {
        data: [
          { value: 'BA', label: 'Bratislava' },
          { value: 'KE', label: 'Košice' },
        ],
      },
    }))
    c.configure(config(request), {
      options: { api: 'main', endpoint: 'cities', resultPath: '/data' },
      first: { api: 'main', endpoint: 'cities', resultPath: '/data/0/value' },
    })
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'select',
          key: 'city',
          bindings: { value: { source: 'first' }, options: { source: 'options' } },
        },
      ],
    }
    await c.load(schema)
    await waitFor(async () => expect((await c.validate()).valid).toBe(true))
    expect((await c.validate()).values!.city).toBe('BA')
    expect(request.mock.calls.map(([req]) => req.context.key).sort()).toEqual(['first', 'options'])
    request.mockClear()
    await c.load(schema, { city: 'KE' })
    await waitFor(async () => expect((await c.validate()).valid).toBe(true))
    expect((await c.validate()).values!.city).toBe('KE')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0].context.key).toBe('options')
  })

  it('clears invalid dependent selections after successful data, reruns rules, and ignores late old cities', async () => {
    const regions = deferred<{ data: unknown }>(),
      staleCities = deferred<{ data: unknown }>()
    const onSubmit = vi.fn()
    const request = vi.fn(async (request: ApiRequest) => {
      const params = new URL(request.url).searchParams
      if (request.context.key === 'regions') {
        return params.get('country') === 'CZ'
          ? regions.promise
          : { data: [{ value: 'SK-BA', label: 'Bratislava Region' }] }
      }
      if (params.get('country') === 'SK') return { data: [{ value: 'BA', label: 'Bratislava' }] }
      return params.has('region') ? staleCities.promise : { data: [{ value: 'BR', label: 'Brno' }] }
    })
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'select',
          key: 'country',
          view: { label: 'Country' },
          current_value: 'SK',
          options: [
            { value: 'SK', label: 'Slovakia' },
            { value: 'CZ', label: 'Czechia' },
          ],
        },
        {
          type: 'select',
          key: 'region',
          view: { label: 'Region' },
          current_value: 'SK-BA',
          bindings: { options: { source: 'regions', params: { country: { ref: 'country' } } } },
        },
        {
          type: 'select',
          key: 'city',
          view: { label: 'City' },
          current_value: 'BA',
          bindings: {
            options: {
              source: 'cities',
              params: { country: { ref: 'country' }, region: { ref: 'region' } },
            },
          },
        },
        {
          type: 'text',
          key: 'status',
          view: { label: 'Status' },
          rules: [
            {
              when: { property: 'region', operation: 'Eq', value: 'SK-BA' },
              then: [{ kind: 'set_value', value: 'Region ready' }],
            },
            {
              when: { property: 'region', operation: 'Eq', value: null },
              then: [{ kind: 'set_value', value: 'Region cleared' }],
            },
          ],
        },
      ],
    }
    render(
      <Tungsten
        schema={schema}
        config={config(request)}
        dataSources={{
          regions: { api: 'main', endpoint: 'regions' },
          cities: { api: 'main', endpoint: 'cities' },
        }}
        onSubmit={onSubmit}
      />,
    )
    const country = await screen.findByRole('combobox', { name: 'Country' })
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('Region ready'))
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'City' })).toHaveTextContent('Bratislava'),
    )
    fireEvent.click(country)
    fireEvent.click(screen.getByRole('option', { name: 'Czechia' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Region' })).toBeDisabled())
    // Pending data keeps the last confirmed labels rather than flashing "Unavailable".
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('Bratislava Region')
    expect(screen.getByLabelText('Status')).toHaveValue('Region ready')
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled())
    expect(onSubmit).not.toHaveBeenCalled()
    regions.resolve({ data: [{ value: 'CZ-JM', label: 'South Moravian Region' }] })
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('Select…'),
    )
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('Region cleared'))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'City' })).toBeEnabled())
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveTextContent('Select…')
    fireEvent.click(screen.getByRole('combobox', { name: 'City' }))
    fireEvent.click(screen.getByRole('option', { name: 'Brno' }))
    staleCities.resolve({ data: [{ value: 'BA', label: 'Stale Bratislava' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        country: 'CZ',
        region: null,
        city: 'BR',
        status: 'Region cleared',
      }),
    )
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveTextContent('Brno')
  })

  it('keeps valid multi-select choices and applies clearing rules when all loaded choices disappear', async () => {
    const response = deferred<{ data: unknown }>()
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ value: 'BA', label: 'Bratislava' }] })
      .mockReturnValueOnce(response.promise)
    const c = client()
    c.configure(config(request), { cities: { api: 'main', endpoint: 'cities' } })
    await c.load({
      schemaVersion: 'sprout',
      form: [
        { type: 'text', key: 'country', current_value: 'SK' },
        {
          type: 'select',
          key: 'cities',
          multiple: true,
          current_value: ['BA', 'KE'],
          bindings: { options: { source: 'cities', params: { country: { ref: 'country' } } } },
        },
        {
          type: 'text',
          key: 'status',
          rules: [
            {
              when: { property: 'cities', operation: 'Eq', value: [] },
              then: [{ kind: 'set_value', value: 'Cleared' }],
            },
          ],
        },
      ],
    })
    await waitFor(async () => expect((await c.validate()).values!.cities).toEqual(['BA']))
    await c.patch({ kind: 'set_value', key: 'country', value: 'CZ' })
    expect((await c.validate()).values!.cities).toEqual(['BA'])
    response.resolve({ data: [] })
    await waitFor(async () =>
      expect((await c.validate()).values).toEqual({ country: 'CZ', cities: [], status: 'Cleared' }),
    )
  })

  it('preserves a saved selection on fetch failure and clears an obsolete initial value only after retry succeeds', async () => {
    const retry = deferred<{ data: unknown }>()
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Connection lost'))
      .mockReturnValueOnce(retry.promise)
    const onSubmit = vi.fn()
    render(
      <Tungsten
        schema={{
          schemaVersion: 'sprout',
          form: [
            {
              type: 'select',
              key: 'region',
              view: { label: 'Region' },
              options: [{ value: 'OLD', label: 'Saved region' }],
              bindings: { options: { source: 'regions' } },
            },
          ],
        }}
        initialValues={{ region: 'OLD' }}
        config={config(request)}
        dataSources={{ regions: { api: 'main', endpoint: 'regions' } }}
        onSubmit={onSubmit}
      />,
    )
    const retryButton = await screen.findByRole('button', { name: 'Retry loading' })
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('Saved region')
    fireEvent.click(retryButton)
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('Saved region')
    retry.resolve({ data: [{ value: 'NEW', label: 'New region' }] })
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('Select…'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ region: null }))
  })

  it('fetches only referenced sources, disables only loading fields, applies nested options and submits values', async () => {
    const response = deferred<{ data: unknown }>()
    const request = vi.fn(() => response.promise)
    const onSubmit = vi.fn()
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        { type: 'text', key: 'name', view: { label: 'Name' } },
        {
          type: 'select',
          key: 'city',
          view: { label: 'City' },
          bindings: { options: { source: 'cities' } },
          validators: [{ kind: 'required' }],
        },
      ],
    }
    render(
      <Tungsten
        schema={schema}
        config={config(request)}
        dataSources={{
          cities: { api: 'main', endpoint: 'cities', resultPath: '/data' },
          unused: { api: 'main', endpoint: 'unused' },
        }}
        onSubmit={onSubmit}
      />,
    )
    const select = await screen.findByLabelText(/^City/)
    expect(select).toBeDisabled()
    expect(screen.getByLabelText('Name')).toBeEnabled()
    expect(screen.getByRole('status', { name: 'Loading options' })).toBeInTheDocument()
    expect(screen.queryByText('Loading data…')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
    response.resolve({ data: { data: [{ value: 'BA', label: 'Bratislava' }] } })
    await waitFor(() => expect(select).toBeEnabled())
    expect(screen.queryByRole('status', { name: 'Loading options' })).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    fireEvent.click(select)
    fireEvent.click(screen.getByRole('option', { name: 'Bratislava' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Ada', city: 'BA' }))
  })
  it('shows source errors and retries a malformed response', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [1] })
      .mockResolvedValueOnce({ data: [{ value: 'one', label: 'One' }] })
    render(
      <Tungsten
        schema={{
          schemaVersion: 'sprout',
          form: [
            {
              type: 'select',
              key: 'choice',
              view: { label: 'Choice' },
              bindings: { options: { source: 'choices' } },
            },
          ],
        }}
        config={config(request)}
        dataSources={{ choices: { api: 'main', endpoint: 'choices' } }}
        onSubmit={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(screen.getByLabelText('Choice')).toBeEnabled())
    fireEvent.click(screen.getByLabelText('Choice'))
    await screen.findByRole('option', { name: 'One' })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('recovers a lost connection by retry without disabling unrelated fields or submitting stale options', async () => {
    const retry = deferred<{ data: unknown }>()
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Connection lost'))
      .mockReturnValueOnce(retry.promise)
    const onSubmit = vi.fn()
    render(
      <Tungsten
        schema={{
          schemaVersion: 'sprout',
          form: [
            { type: 'text', key: 'name', view: { label: 'Name' } },
            {
              type: 'select',
              key: 'city',
              multiple: true,
              view: { label: 'Cities' },
              bindings: { options: { source: 'cities' } },
              validators: [{ kind: 'required' }],
            },
          ],
        }}
        config={config(request)}
        dataSources={{ cities: { api: 'main', endpoint: 'cities' } }}
        onSubmit={onSubmit}
      />,
    )
    const retryButton = await screen.findByRole('button', { name: 'Retry loading' })
    expect(screen.getByText('Connection lost')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled())
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(retryButton)
    await screen.findByRole('status', { name: 'Loading options' })
    expect(screen.getByRole('combobox', { name: 'Cities' })).toBeDisabled()
    retry.resolve({
      data: [
        { value: 'BA', label: 'Bratislava' },
        { value: 'KE', label: 'Košice' },
      ],
    })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Cities' })).toBeEnabled())
    fireEvent.click(screen.getByRole('combobox', { name: 'Cities' }))
    fireEvent.click(screen.getByRole('option', { name: 'Bratislava' }))
    fireEvent.click(screen.getByRole('option', { name: 'Košice' }))
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Košice' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ city: ['BA', 'KE'], name: null }))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('applies rapid chip removals and clear-all through the actual worker without resurrecting selections', async () => {
    const onSubmit = vi.fn()
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'select',
          key: 'cities',
          multiple: true,
          view: { label: 'Cities' },
          current_value: ['BA', 'KE', 'PR'],
          options: [
            { value: 'BA', label: 'Bratislava' },
            { value: 'KE', label: 'Košice' },
            { value: 'PR', label: 'Prague' },
          ],
        },
      ],
    }
    render(<Tungsten schema={schema} onSubmit={onSubmit} />)
    const trigger = await screen.findByRole('combobox', { name: 'Cities' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bratislava' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Košice' }))
    await waitFor(() => expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1))
    expect(screen.queryByRole('button', { name: 'Remove Bratislava' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Košice' })).not.toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove Prague' })).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ cities: [] }))
  })

  it('retries only the interrupted attachment after a partial upload and keeps the same idempotency key', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'first-durable' } })
      .mockRejectedValueOnce(new TypeError('Connection reset'))
      .mockResolvedValueOnce({ data: { id: 'second-durable' } })
    const c = client(config(request))
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [{ ...fileSchema().form[0], multiple: true }],
    }
    await c.load(schema)
    await c.selectFiles(schema.form[0] as never, [
      new File(['one'], 'one.txt'),
      new File(['two'], 'two.txt'),
    ])
    await expect(c.prepareFiles()).rejects.toThrow('Connection reset')
    const saved = await c.prepareFiles()
    expect(saved.values!.attachment).toMatchObject({
      files: [
        { id: 'first-durable', uploaded: true },
        { id: 'second-durable', uploaded: true },
      ],
    })
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[1][0].context.idempotencyKey).toBe(
      request.mock.calls[2][0].context.idempotencyKey,
    )
    expect(request.mock.calls[0][0].context.idempotencyKey).not.toBe(
      request.mock.calls[1][0].context.idempotencyKey,
    )
  })
  it('uploads on submit, sends durable IDs, and reuses success after a submit callback fails', async () => {
    const request = vi.fn(async () => ({ data: { id: 'uploaded-1' } }))
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Save failed'))
      .mockResolvedValueOnce(undefined)
    render(<Tungsten schema={fileSchema()} config={config(request)} onSubmit={onSubmit} />)
    const input = await screen.findByLabelText(/^Attachment/)
    fireEvent.change(input, {
      target: { files: [new File(['hello'], 'hello.txt', { type: 'text/plain' })] },
    })
    await screen.findByText(/Pending upload/)
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled())
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument()
    expect(onSubmit.mock.calls[0][0]).toEqual({
      attachment: {
        files: [
          { id: 'uploaded-1', name: 'hello.txt', size: 5, mediaType: 'text/plain', uploaded: true },
        ],
      },
    })
    expect(request.mock.calls[0][0].body).toBeInstanceOf(FormData)
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('uploads on selection and disables the field while uploading', async () => {
    const upload = deferred<{ data: unknown }>()
    const request = vi.fn(() => upload.promise)
    const onSubmit = vi.fn()
    render(
      <Tungsten schema={fileSchema('selection')} config={config(request)} onSubmit={onSubmit} />,
    )
    const input = await screen.findByLabelText(/^Attachment/)
    fireEvent.change(input, { target: { files: [new File(['hello'], 'hello.txt')] } })
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(input).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
    upload.resolve({ data: { id: 'durable' } })
    await screen.findByText(/Uploaded/)
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('keeps attachments when the picker is cancelled and removes only the chosen file', async () => {
    const request = vi.fn(async () => ({ data: { id: 'unused' } }))
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [{ ...fileSchema().form[0], multiple: true }],
    }
    render(<Tungsten schema={schema} config={config(request)} onSubmit={vi.fn()} />)
    const input = await screen.findByLabelText(/^Attachment/)
    fireEvent.change(input, {
      target: { files: [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')] },
    })
    await screen.findByText('one.txt')
    await screen.findByText('two.txt')
    fireEvent.change(input, { target: { files: [] } })
    expect(screen.getByText('one.txt')).toBeInTheDocument()
    expect(screen.getByText('two.txt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove one.txt' }))
    await waitFor(() => expect(screen.queryByText('one.txt')).not.toBeInTheDocument())
    expect(screen.getByText('two.txt')).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })
  it('retries failed uploads and restores durable drafts without re-uploading', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Upload failed'))
      .mockResolvedValueOnce({ data: { id: 'durable' } })
    const c = client(config(request))
    const schema = fileSchema()
    await c.load(schema)
    await c.selectFiles(schema.form[0] as never, [new File(['hello'], 'hello.txt')])
    await expect(c.prepareFiles()).rejects.toThrow('Upload failed')
    const saved = await c.prepareFiles()
    expect(saved.valid).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
    await c.load(schema, saved.values as TungstenValues)
    expect((await c.prepareFiles()).values).toEqual(saved.values)
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('rejects restored pending handles without bytes instead of silently submitting metadata', async () => {
    const request = vi.fn(async () => ({ data: { id: 'wrong' } }))
    const c = client(config(request))
    await c.load(fileSchema(), {
      attachment: {
        files: [{ id: 'old-local', name: 'hello.txt', size: 5, mediaType: '', uploaded: false }],
      },
    })
    await expect(c.prepareFiles()).rejects.toMatchObject({ messageKey: 'tg_file_missing_bytes' })
    expect(request).not.toHaveBeenCalled()
  })
  it('ignores obsolete generations and late source results after an input change', async () => {
    const first = deferred<{ data: unknown }>(),
      second = deferred<{ data: unknown }>()
    const request = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const c = client()
    c.configure(config(request), { names: { api: 'main', endpoint: 'names' } })
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        { type: 'text', key: 'input', current_value: 'one' },
        {
          type: 'text',
          key: 'output',
          bindings: {
            value: { source: 'names', apply: 'live', params: { input: { ref: 'input' } } },
          },
        },
      ],
    }
    const initial = await c.load(schema)
    const effect = initial.effects![0]
    await c.patch({ kind: 'set_value', key: 'input', value: 'two' })
    second.resolve({ data: 'new' })
    await waitFor(async () => expect((await c.validate()).state.fields.output.value).toBe('new'))
    first.resolve({ data: 'old' })
    expect(
      (
        await c.integrate(initial.generation!, {
          kind: 'source',
          command: { kind: 'resolve', id: effect.id, revision: effect.revision, data: 'old' },
        })
      ).state.fields.output.value,
    ).toBe('new')
    const fresh = await c.load({
      schemaVersion: 'sprout',
      form: [{ type: 'text', key: 'output', current_value: 'fresh' }],
    })
    expect(fresh.generation).not.toBe(initial.generation)
    expect(
      (
        await c.integrate(initial.generation!, {
          kind: 'source',
          command: { kind: 'resolve', id: effect.id, revision: effect.revision, data: 'old' },
        })
      ).state.fields.output.value,
    ).toBe('fresh')
  })
  it('keeps upload results with their repeater row after reorder', async () => {
    const upload = deferred<{ data: unknown }>()
    const c = client(config(() => upload.promise))
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'repeater',
          key: 'rows',
          reorder: true,
          render: { type: 'undereachother', settings: {} },
          template: [
            {
              type: 'file',
              key: 'rows.file',
              upload: { api: 'main', endpoint: 'files', timing: 'selection' },
            },
          ],
        },
      ],
    }
    const loaded = await c.load(schema, { rows: [{}, {}] })
    const field = loaded.state.repeaters!.rows.instances[0].form[0]
    const selecting = c.selectFiles(field as never, [new File(['hi'], 'hi.txt')])
    await waitFor(async () =>
      expect((await c.validate()).state.fields['rows[0].file'].uploading).toBe(true),
    )
    await c.reorderInstance('rows', 0, 1)
    upload.resolve({ data: { id: 'durable' } })
    await selecting
    const values = (await c.validate()).values! as { rows: { file: { files: { id: string }[] } }[] }
    expect(values.rows[0].file.files).toEqual([])
    expect(values.rows[1].file.files[0].id).toBe('durable')
  })
  it('sends affected state only and explicitly recovers a mismatched delta without resetting values', async () => {
    const c = client()
    await c.load({
      schemaVersion: 'sprout',
      form: Array.from({ length: 10_000 }, (_, i) => ({ type: 'text', key: `field${i}` })),
    })
    await c.patch({ kind: 'set_value', key: 'field5000', value: 'first' })
    const delta = transport.responses.at(-1)!
    expect(delta.kind).toBe('delta')
    expect(delta).not.toHaveProperty('state')
    expect(Object.keys(delta.fields as object)).toEqual(['field5000'])
    transport.corrupt = true
    const recovered = await c.patch({ kind: 'set_value', key: 'field6000', value: 'second' })
    expect(transport.responses.at(-1)!.kind).toBe('snapshot')
    expect(recovered.state.fields.field5000.value).toBe('first')
    expect(recovered.state.fields.field6000.value).toBe('second')
  })
  it('prepares files for an incomplete draft while keeping submission invalid', async () => {
    const request = vi.fn(async () => ({ data: { id: 'draft-file' } }))
    const c = client(config(request))
    const schema: TungstenSchema = {
      ...fileSchema(),
      form: [
        ...fileSchema().form,
        { type: 'text', key: 'name', validators: [{ kind: 'required' }] },
      ],
    }
    await c.load(schema)
    await c.selectFiles(schema.form[0] as never, [new File(['hi'], 'hi.txt')])
    expect((await c.prepareFiles()).valid).toBe(false)
    expect(request).not.toHaveBeenCalled()
    const draft = await c.prepareFiles({ allowInvalid: true })
    expect(draft.valid).toBe(false)
    expect(draft.values!.attachment).toMatchObject({
      files: [{ id: 'draft-file', uploaded: true }],
    })
    expect(request).toHaveBeenCalledTimes(1)
    await c.load(schema)
    const empty = await c.prepareFiles({ allowInvalid: true })
    expect(empty.valid).toBe(false)
    expect(empty.values!.attachment).toEqual({ files: [] })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retains selected bytes while an earlier state response is still queued', async () => {
    const request = vi.fn(async () => ({ data: { id: 'queued-file' } }))
    const c = client(config(request))
    const schema = fileSchema()
    await c.load(schema)
    const validating = c.validate()
    const selecting = c.selectFiles(schema.form[0] as never, [new File(['hi'], 'hi.txt')])
    await validating
    await selecting
    expect((await c.prepareFiles()).values!.attachment).toMatchObject({
      files: [{ id: 'queued-file', uploaded: true }],
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('text and boolean variants with real core and data sources', () => {
  it('preserves password masking and textarea newlines for asynchronous values and reopened drafts', async () => {
    const pending = deferred<{ data: unknown }>()
    const request = vi.fn(() => pending.promise)
    const settings = config(request)
    const sources = { secret: { api: 'main', endpoint: 'secret' } }
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'text',
          variant: 'password',
          key: 'secret',
          view: { label: 'Password' },
          bindings: { value: { source: 'secret' } },
          validators: [{ kind: 'required' }],
        },
        { type: 'text', variant: 'email', key: 'email', view: { label: 'Email' } },
        { type: 'text', variant: 'tel', key: 'tel', view: { label: 'Telephone' } },
        {
          type: 'text',
          textarea: true,
          rows: 4,
          resizable: false,
          key: 'notes',
          view: { label: 'Notes' },
        },
      ],
    }
    const onSubmit = vi.fn()
    const view = render(
      <Tungsten
        schema={schema}
        config={settings}
        dataSources={sources}
        initialValues={{ email: ' ada@example.com ', tel: '+00123', notes: 'First\nSecond' }}
        onSubmit={onSubmit}
      />,
    )
    const password = await screen.findByLabelText(/^Password/)
    expect(password).toBeDisabled()
    expect(password).toHaveAttribute('type', 'password')
    pending.resolve({ data: '  loaded secret  ' })
    await waitFor(() => expect(password).toBeEnabled())
    expect(password).toHaveValue('  loaded secret  ')
    expect(password).toHaveAttribute('type', 'password')
    expect(screen.queryByText('  loaded secret  ')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Notes')).toHaveValue('First\nSecond')
    expect(screen.getByLabelText('Notes')).toHaveAttribute('rows', '4')
    expect(screen.getByLabelText('Notes')).toHaveStyle({ resize: 'none' })
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')
    expect(screen.getByLabelText('Telephone')).toHaveValue('+00123')
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        secret: '  loaded secret  ',
        email: 'ada@example.com',
        tel: '+00123',
        notes: 'First\nSecond',
      }),
    )
    view.rerender(
      <Tungsten
        schema={schema}
        config={settings}
        dataSources={sources}
        initialValues={{ secret: '  draft secret  ', notes: 'Saved\nDraft' }}
        onSubmit={onSubmit}
      />,
    )
    await waitFor(() => expect(screen.getByLabelText(/^Password/)).toHaveValue('  draft secret  '))
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Notes')).toHaveValue('Saved\nDraft')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('loads boolean options through the API, retains false drafts, applies rules and submits false as required', async () => {
    const pending = deferred<{ data: unknown }>()
    const settings = config(() => pending.promise)
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'boolean',
          variant: 'radio',
          direction: 'row',
          key: 'answer',
          view: { label: 'Answer' },
          validators: [{ kind: 'required' }],
          bindings: { options: { source: 'answers' } },
        },
        {
          type: 'text',
          key: 'status',
          view: { label: 'Status' },
          rules: [
            {
              when: { property: 'answer', operation: 'Eq', value: false },
              then: [{ kind: 'set_value', value: 'Declined' }],
            },
          ],
        },
        {
          type: 'boolean',
          variant: 'switch',
          key: 'updates',
          view: { label: 'Updates' },
          validators: [{ kind: 'required' }],
        },
      ],
    }
    const onSubmit = vi.fn()
    render(
      <Tungsten
        schema={schema}
        initialValues={{ answer: false, updates: false }}
        config={settings}
        dataSources={{ answers: { api: 'main', endpoint: 'answers', resultPath: '/data' } }}
        onSubmit={onSubmit}
      />,
    )
    const group = await screen.findByRole('radiogroup', { name: /^Answer/ })
    expect(group).toHaveAttribute('aria-busy', 'true')
    pending.resolve({
      data: {
        data: [
          { value: true, label: 'Accept' },
          { value: false, label: 'Decline' },
        ],
      },
    })
    const no = await screen.findByRole('radio', { name: 'Decline' })
    expect(no).toBeChecked()
    expect(no).toBeEnabled()
    expect(group).toHaveAttribute('data-direction', 'row')
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('Declined'))
    expect(screen.getByRole('switch', { name: /^Updates/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ answer: false, updates: false, status: 'Declined' }),
    )
    fireEvent.keyDown(no, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Accept' })).toBeChecked())
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(screen.getByText('This field is required.')).toBeInTheDocument())
  })

  it('retries malformed boolean options without coercing string false or losing the saved value', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ value: 'false', label: 'No' }] })
      .mockResolvedValueOnce({ data: [{ value: false, label: 'No' }] })
    render(
      <Tungsten
        schema={{
          schemaVersion: 'sprout',
          form: [
            {
              type: 'boolean',
              variant: 'radio',
              key: 'answer',
              view: { label: 'Answer' },
              bindings: { options: { source: 'answers' } },
            },
          ],
        }}
        initialValues={{ answer: false }}
        config={config(request)}
        dataSources={{ answers: { api: 'main', endpoint: 'answers' } }}
        onSubmit={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Retry loading' }))
    expect(await screen.findByRole('radio', { name: 'No' })).toBeChecked()
    expect(request).toHaveBeenCalledTimes(2)
  })
})

it.each([
  { variant: 'email', source: '  ada@example.com  ', expected: 'ada@example.com', settings: {} },
  { variant: 'tel', source: '+00123', expected: '+00123', settings: {} },
  {
    variant: 'plain',
    source: 'One\nTwo',
    expected: 'One\nTwo',
    settings: { textarea: true, rows: 3 },
  },
])(
  'loads and edits async $variant text values through their configured renderer',
  async ({ variant, source, expected, settings }) => {
    const response = deferred<{ data: unknown }>()
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'text',
          variant,
          ...settings,
          key: 'value',
          view: { label: 'Value' },
          bindings: { value: { source: 'value' } },
        },
      ],
    }
    render(
      <Tungsten
        schema={schema}
        config={config(() => response.promise)}
        dataSources={{ value: { api: 'main', endpoint: 'value' } }}
        onSubmit={vi.fn()}
      />,
    )
    const input = await screen.findByLabelText('Value')
    expect(input).toBeDisabled()
    response.resolve({ data: source })
    await waitFor(() => expect(input).toHaveValue(expected))
    expect(input).toBeEnabled()
    if (variant !== 'plain') expect(input).toHaveAttribute('type', variant)
    else expect(input.tagName).toBe('TEXTAREA')
  },
)

it('changes language on a filled form without core commands, data refetches, state emissions or lost values', async () => {
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      {
        type: 'text',
        key: 'name',
        view: { label: 'form.name', placeholder: 'form.placeholder' },
        validators: [{ kind: 'min_length', value: 5 }],
      },
      { type: 'text', variant: 'password', key: 'secret', view: { label: 'form.password' } },
      {
        type: 'select',
        key: 'country',
        multiple: true,
        view: { label: 'form.country' },
        bindings: { options: { source: 'countries' } },
      },
      {
        type: 'repeater',
        key: 'people',
        view: { label: 'form.people' },
        render: { type: 'undereachother', settings: {} },
        reorder: true,
        template: [
          {
            type: 'group',
            key: 'people.person',
            variant: 'basic',
            view: { label: 'form.person' },
            render: { type: 'card', settings: {} },
            subform: [
              { type: 'text', key: 'people.person.name', view: { label: 'form.person.name' } },
            ],
          },
        ],
      },
    ],
  }
  const request = vi.fn(async () => ({ data: [{ value: 'sk', label: 'country.sk' }] }))
  const translations = {
    en: {
      'form.name': 'Name',
      'form.placeholder': 'Enter name',
      'form.password': 'Password',
      'form.country': 'Country',
      'form.people': 'People',
      'form.person': 'Person',
      'form.person.name': 'Person name',
      'country.sk': 'Slovakia',
    },
    sk: {
      'form.name': 'Meno',
      'form.placeholder': 'Zadajte meno',
      'form.password': 'Heslo',
      'form.country': 'Krajina',
      'form.people': 'Ľudia',
      'form.person': 'Osoba',
      'form.person.name': 'Meno osoby',
      'country.sk': 'Slovensko',
      tg_validation_min_length: 'Aspoň {min} znakov.',
      tg_ui_submit: 'Odoslať',
    },
  }
  const initialValues = {
    name: 'Ada',
    secret: 'form.name',
    country: ['sk'],
    people: [{ person: { name: 'A' } }, { person: { name: 'B' } }],
  }
  const dataSources = { countries: { api: 'main', endpoint: 'countries' } }
  const onStateChange = vi.fn(),
    onReady = vi.fn(),
    onSubmit = vi.fn()
  const englishConfig = { ...config(request), i18n: { translations } }
  const view = render(
    <Tungsten
      schema={schema}
      initialValues={initialValues}
      config={englishConfig}
      dataSources={dataSources}
      language="en"
      onStateChange={onStateChange}
      onReady={onReady}
      onSubmit={onSubmit}
    />,
  )
  const input = await screen.findByLabelText('Name')
  await screen.findByText('Slovakia')
  expect(screen.getByText('Must contain at least 5 characters.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '#1 Person' })).toBeInTheDocument()
  const state = onStateChange.mock.calls.at(-1)![0]
  expect(state.state.fields.name.errors).toEqual([
    { messageKey: 'tg_validation_min_length', params: { min: 5 } },
  ])
  const events = onStateChange.mock.calls.length,
    commands = transport.responses.length
  // A new config object carrying only i18n changes must also preserve the engine.
  view.rerender(
    <Tungsten
      schema={schema}
      initialValues={initialValues}
      config={{ ...englishConfig, i18n: { translations } }}
      dataSources={dataSources}
      language="sk"
      onStateChange={onStateChange}
      onReady={onReady}
      onSubmit={onSubmit}
    />,
  )
  await screen.findByText('Aspoň 5 znakov.')
  expect(screen.getByLabelText('Meno')).toBe(input)
  expect(input).toHaveValue('Ada')
  expect(input).toHaveAttribute('placeholder', 'Zadajte meno')
  expect(screen.getByLabelText('Heslo')).toHaveValue('form.name')
  expect(screen.getByLabelText('Heslo')).toHaveAttribute('type', 'password')
  expect(screen.getByText('Slovensko')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '#1 Osoba' })).toBeInTheDocument()
  expect(onReady).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledTimes(1)
  expect(onStateChange).toHaveBeenCalledTimes(events)
  expect(transport.responses).toHaveLength(commands)
  expect(onStateChange.mock.calls.at(-1)![0]).toBe(state)
  expect(document.querySelector('form')).toHaveAttribute('lang', 'sk')
})

it('translates source/upload failures using keys and status parameters with an English fallback', async () => {
  const request = vi.fn(async () => ({ status: 503, data: null }))
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      {
        type: 'select',
        key: 'choice',
        view: { label: 'Choice' },
        bindings: { options: { source: 'choices' } },
      },
    ],
  }
  const translated = {
    ...config(request),
    i18n: {
      translations: {
        sk: { tg_api_http_error: 'Server vrátil {status}.', tg_ui_retry_loading: 'Skúsiť znova' },
      },
    },
  }
  const onStateChange = vi.fn()
  render(
    <Tungsten
      schema={schema}
      config={translated}
      language="sk"
      dataSources={{ choices: { api: 'main', endpoint: 'choices' } }}
      onSubmit={vi.fn()}
      onStateChange={onStateChange}
    />,
  )
  await screen.findByText('Server vrátil 503.')
  expect(screen.getByRole('button', { name: 'Skúsiť znova' })).toBeInTheDocument()
  expect(onStateChange.mock.calls.at(-1)![0].state.fields.choice.sourceErrors).toEqual({
    '0:options': { messageKey: 'tg_api_http_error', params: { status: 503 } },
  })
})

it('preserves edits when language/config are first added and later removed', async () => {
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [{ type: 'text', key: 'name', view: { label: 'Name' } }],
  }
  const onStateChange = vi.fn(),
    onSubmit = vi.fn()
  const view = render(
    <Tungsten schema={schema} onStateChange={onStateChange} onSubmit={onSubmit} />,
  )
  const input = await screen.findByLabelText('Name')
  fireEvent.change(input, { target: { value: 'Edited' } })
  await waitFor(() => expect(onStateChange.mock.calls.at(-1)![0].values.name).toBe('Edited'))
  const commands = transport.responses.length,
    emissions = onStateChange.mock.calls.length
  const config = { i18n: { translations: { sk: { Name: 'Meno' } } } }
  view.rerender(
    <Tungsten
      schema={schema}
      config={config}
      language="sk"
      onStateChange={onStateChange}
      onSubmit={onSubmit}
    />,
  )
  expect(await screen.findByLabelText('Meno')).toBe(input)
  expect(input).toHaveValue('Edited')
  view.rerender(<Tungsten schema={schema} onStateChange={onStateChange} onSubmit={onSubmit} />)
  expect(await screen.findByLabelText('Name')).toBe(input)
  expect(input).toHaveValue('Edited')
  expect(transport.responses).toHaveLength(commands)
  expect(onStateChange).toHaveBeenCalledTimes(emissions)
})

describe('agreed diagnostic and reset contracts / real core', () => {
  const warningSchema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      { type: 'text', key: 'source', view: { label: 'Source' } },
      {
        type: 'text',
        key: 'target',
        current_value: 'A',
        rules: [
          {
            when: { property: 'source', operation: 'Eq', value: 'go' },
            then: [
              { kind: 'set_value', value: 'B' },
              { kind: 'set_value', value: 'C' },
            ],
          },
        ],
      },
    ],
  }
  it('delivers structured localized warnings when console warnings are silenced', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const diagnostic = vi.fn()
    render(
      <Tungsten schema={warningSchema} config={{ warnings: 'silent' }} onDiagnostic={diagnostic} />,
    )
    fireEvent.change(await screen.findByLabelText('Source'), { target: { value: 'go' } })
    await waitFor(() =>
      expect(diagnostic).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warning',
          messageKey: 'tg_warning_multiple_value_writes',
          params: { fieldKey: 'target' },
          message: expect.stringContaining('target'),
        }),
      ),
    )
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
  it('processing-cap errors surface in mandatory UI, callback, and console without partial state', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const diagnostic = vi.fn()
    render(
      <Tungsten
        schema={warningSchema}
        config={{ maxProcessingSteps: 2, warnings: 'silent' }}
        onDiagnostic={diagnostic}
      />,
    )
    const source = await screen.findByLabelText('Source')
    fireEvent.change(source, { target: { value: 'go' } })
    await waitFor(() =>
      expect(diagnostic).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          messageKey: 'tg_schema_patch_processing_exceeded_safety_limit',
        }),
      ),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/safety|limit/i)
    expect(source).toHaveValue('')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
  it('a throwing diagnostic observer cannot corrupt a successful patch or recursively emit', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const c = client({ warnings: 'silent' })
    await c.load(warningSchema)
    const listener = vi.fn(() => {
      throw new Error('observer')
    })
    c.subscribeDiagnostic(listener)
    const response = await c.patch({ kind: 'set_value', key: 'source', value: 'go' })
    expect(response.state.fields.target.value).toBe('C')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
  it('validation errors retain values without diagnostic events', async () => {
    const c = client()
    const listener = vi.fn()
    c.subscribeDiagnostic(listener)
    await c.load({
      schemaVersion: 'sprout',
      form: [{ type: 'text', variant: 'email', key: 'email' }],
    })
    const response = await c.patch({ kind: 'set_value', key: 'email', value: 'invalid' })
    expect(response.state.fields.email.value).toBe('invalid')
    expect(response.state.fields.email.errors).toHaveLength(1)
    expect(listener).not.toHaveBeenCalled()
  })
  it('reset restores the explicit baseline, null/false/zero and schema defaults, not an edited draft', async () => {
    const c = client()
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        { type: 'text', key: 'text', current_value: 'Default' },
        { type: 'number', key: 'number' },
        { type: 'boolean', key: 'bool' },
      ],
    }
    const baseline = { text: null, number: 0, bool: false }
    await c.load(schema, baseline)
    baseline.text = null
    await c.patch({ kind: 'set_value', key: 'text', value: 'edited' })
    expect((await c.reset()).state.fields.text.value).toBeNull()
    await c.loadValues({ number: 7 })
    await c.patch({ kind: 'set_value', key: 'number', value: 9 })
    const reset = await c.reset()
    expect(reset.state.fields.number.value).toBe(7)
    expect(reset.state.fields.text.value).toBe('Default')
  })
  it.each([0, -1, 1.5, Infinity, NaN])(
    'rejects invalid maxProcessingSteps %s before loading',
    (maxProcessingSteps) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => client({ maxProcessingSteps })).toThrow('tg_schema_invalid_processing_limit')
      expect(error).toHaveBeenCalledExactlyOnceWith('tg_schema_invalid_processing_limit')
      error.mockRestore()
    },
  )
})

describe('save and submit integration / real core', () => {
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      { type: 'text', key: 'name', view: { label: 'Name' }, validators: [{ kind: 'required' }] },
    ],
  }
  it('configured submit shows the active design outcome and invokes its observer after HTTP failure', async () => {
    const pending = deferred<{ data: unknown; status: number }>()
    const request = vi.fn(() => pending.promise),
      callback = vi.fn()
    render(
      <Tungsten
        schema={schema}
        initialValues={{ name: 'Ada' }}
        config={{
          ...config(request),
          submission: { endpoint: { api: 'main', endpoint: 'submit' } },
        }}
        onSubmit={callback}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(callback).not.toHaveBeenCalled()
    pending.resolve({ data: { errors: { name: 'Server rejection' } }, status: 422 })
    await waitFor(() =>
      expect(callback).toHaveBeenCalledWith(
        { name: 'Ada' },
        expect.objectContaining({ status: 'error' }),
      ),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Form could not be submitted.')
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Ada')
  })
  it('configured submit works without an observer, and supports disabling builtin status', async () => {
    const request = vi.fn(async () => ({ data: null, status: 204 }))
    render(
      <Tungsten
        schema={schema}
        initialValues={{ name: 'Ada' }}
        config={{
          ...config(request),
          submission: { endpoint: { api: 'main', endpoint: 'submit' }, showStatus: false },
        }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled())
    expect(screen.queryByText('Form submitted.')).not.toBeInTheDocument()
  })
  it('an invalid draft autosaves after debounce, a no-op does not, and changed reset is saved', async () => {
    const request = vi.fn(async () => ({ data: null, status: 204 }))
    const onSave = vi.fn()
    let controller!: EngineClient
    render(
      <Tungsten
        schema={schema}
        initialValues={{ name: 'Initial' }}
        onReady={(client) => {
          controller = client
        }}
        config={{
          ...config(request),
          autosave: { endpoint: { api: 'main', endpoint: 'drafts' }, debounceMs: 20 },
        }}
        onSave={onSave}
      />,
    )
    const input = await screen.findByLabelText(/^Name/)
    expect(request).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    const saved = JSON.parse(request.mock.calls[0][0].body as string)
    expect(saved.values).toEqual({ name: '' })
    expect(saved).toMatchObject({
      timestamp: expect.any(Number),
      revision: 1,
      writerId: expect.any(String),
    })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument()
    await controller.patch({ kind: 'set_value', key: 'name', value: '' })
    await controller.reset()
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(JSON.parse(request.mock.calls[1][0].body as string).values).toEqual({ name: 'Initial' })
    expect(onSave).toHaveBeenCalledTimes(2)
  })
  it('semantically disabled fields retain data without blocking; readonly fields still require valid data', async () => {
    const callback = vi.fn()
    render(
      <Tungsten
        schema={{
          schemaVersion: 'sprout',
          form: [
            {
              type: 'text',
              key: 'disabled',
              disabled: true,
              view: { label: 'Disabled' },
              validators: [{ kind: 'required' }],
            },
            {
              type: 'text',
              key: 'readonly',
              readOnly: true,
              view: { label: 'Readonly' },
              validators: [{ kind: 'required' }],
            },
          ],
        }}
        onSubmit={callback}
      />,
    )
    const disabled = await screen.findByLabelText(/^Disabled/)
    expect(disabled).toBeDisabled()
    const readonly = screen.getByLabelText(/^Readonly/)
    expect(readonly).toHaveAttribute('readonly')
    expect(disabled).toHaveAttribute('aria-invalid', 'false')
    expect(readonly).toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(callback).not.toHaveBeenCalled()
  })
  it('reset reconstructs nested repeater baseline rather than an edited collection', async () => {
    const c = client()
    await c.load(
      {
        schemaVersion: 'sprout',
        form: [
          {
            type: 'repeater',
            key: 'people',
            render: { type: 'undereachother', settings: {} },
            template: [{ type: 'text', key: 'people.name' }],
          },
        ],
      },
      { people: [{ name: 'Original' }] },
    )
    await c.addInstance('people')
    await c.patch({ kind: 'set_value', key: 'people[0].name', value: 'Edited' })
    const response = await c.reset()
    expect(response.state.repeaters?.people.length).toBe(1)
    expect(response.state.fields['people[0].name'].value).toBe('Original')
  })
})

it('a worker crash rejects pending and future operations instead of leaving them hanging', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const c = client(),
    diagnostic = vi.fn()
  c.subscribeDiagnostic(diagnostic)
  await c.load({ schemaVersion: 'sprout', form: [{ type: 'text', key: 'name' }] })
  transport.crash = true
  const one = c.patch({ kind: 'set_value', key: 'name', value: 'one' })
  const two = c.validate()
  await expect(one).rejects.toThrow('tg_api_worker_failed')
  await expect(two).rejects.toThrow('tg_api_worker_failed')
  await expect(c.reset()).rejects.toThrow('tg_api_worker_failed')
  expect(diagnostic).toHaveBeenCalledTimes(1)
  expect(error).toHaveBeenCalled()
})

it.each([false, true])(
  'initial async values do not autosave untouched forms; edits during loading are retained (edited=%s)',
  async (edited) => {
    const pending = deferred<{ data: unknown }>(),
      saved = vi.fn()
    const request = vi.fn(() => pending.promise)
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        { type: 'text', key: 'name', view: { label: 'Name' } },
        {
          type: 'text',
          key: 'loaded',
          view: { label: 'Loaded' },
          bindings: { value: { source: 'initial' } },
        },
      ],
    }
    render(
      <Tungsten
        schema={schema}
        config={{ ...config(request), autosave: { debounceMs: 20 } }}
        dataSources={{ initial: { api: 'main', endpoint: 'initial' } }}
        onSave={saved}
      />,
    )
    const input = await screen.findByLabelText('Name')
    if (edited) fireEvent.change(input, { target: { value: 'User edit' } })
    pending.resolve({ data: 'Ready' })
    await waitFor(() => expect(screen.getByLabelText('Loaded')).toHaveValue('Ready'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    if (edited)
      expect(saved).toHaveBeenLastCalledWith(
        { name: 'User edit', loaded: 'Ready' },
        expect.anything(),
      )
    else expect(saved).not.toHaveBeenCalled()
  },
)

it('reset replaces a focused date entry with the restored baseline', async () => {
  let controller!: EngineClient
  render(
    <Tungsten
      schema={{
        schemaVersion: 'sprout',
        form: [{ type: 'date', key: 'day', view: { label: 'Day' } }],
      }}
      initialValues={{ day: '2026-10-09' }}
      onReady={(value) => {
        controller = value
      }}
    />,
  )
  const input = await screen.findByLabelText('Day')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '10/10/2026' } })
  await waitFor(async () => expect((await controller.validate()).values?.day).toBe('2026-10-10'))
  await controller.reset()
  await waitFor(() => expect(input).toHaveValue('10/09/2026'))
})

it.each(['picker', 'onReady'] as const)(
  'autosave prepares files nested in repeater data before passing a durable draft to the host (edit=%s)',
  async (edit) => {
    const request = vi.fn(async () => ({ data: { id: 'stored-nested' }, status: 201 })),
      save = vi.fn()
    const attachment: TungstenField = {
      type: 'file',
      key: 'people.attachment',
      view: { label: 'Attachment' },
      upload: { api: 'main', endpoint: 'files', timing: 'submit' },
    }
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [
        {
          type: 'repeater',
          key: 'people',
          render: { type: 'undereachother', settings: {} },
          template: [attachment],
        },
      ],
    }
    render(
      <Tungsten
        schema={schema}
        initialValues={{ people: [{}] }}
        config={{ ...config(request), autosave: { debounceMs: 20 } }}
        onSave={save}
        onReady={(controller) => {
          if (edit === 'onReady')
            void controller.selectFiles({ ...attachment, key: 'people[0].attachment' }, [
              new File(['nested bytes'], 'nested.txt', { type: 'text/plain' }),
            ])
        }}
      />,
    )
    const input = await screen.findByLabelText('Attachment')
    if (edit === 'picker')
      fireEvent.change(input, {
        target: { files: [new File(['nested bytes'], 'nested.txt', { type: 'text/plain' })] },
      })
    await waitFor(() => expect(save).toHaveBeenCalled())
    for (const [values] of save.mock.calls) {
      expect(values.people[0].attachment.files[0]).toMatchObject({
        id: 'stored-nested',
        uploaded: true,
      })
    }
    expect(request).toHaveBeenCalledTimes(1)
  },
)

it('publishes affected keys without changing the legacy snapshot subscription or retained snapshots', async () => {
  const c = client()
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      { type: 'text', key: 'name', current_value: 'Initial' },
      { type: 'text', key: 'other', current_value: 'Untouched' },
    ],
  }
  const legacy = vi.fn()
  const changes = vi.fn()
  const unsubscribe = c.subscribeChanges(changes)
  c.subscribe(legacy)
  const loaded = await c.load(schema, null)
  Object.freeze(loaded.state.fields.name)
  Object.freeze(loaded.state.fields.other)
  Object.freeze(loaded.state.fields)
  Object.freeze(loaded.state)
  const patched = await c.patch({ kind: 'set_value', key: 'name', value: 'Changed' })
  expect(changes).toHaveBeenLastCalledWith(patched.state, ['name'])
  expect(legacy).toHaveBeenLastCalledWith(patched.state)
  expect(loaded.state.fields.name.value).toBe('Initial')
  expect(patched.state.fields.other).toBe(loaded.state.fields.other)
  const validated = await c.validate()
  expect(changes).toHaveBeenLastCalledWith(validated.state, undefined)
  const count = changes.mock.calls.length
  unsubscribe()
  await c.patch({ kind: 'set_value', key: 'name', value: 'Final' })
  expect(changes).toHaveBeenCalledTimes(count)
})

it('prepares a no-file form with one validated snapshot and keeps complete invalid draft values', async () => {
  const c = client()
  await c.load({
    schemaVersion: 'sprout',
    form: [{ type: 'text', key: 'name', validators: [{ kind: 'required' }] }],
  })
  transport.responses = []
  const response = await c.prepareFiles({ allowInvalid: true })
  expect(response.valid).toBe(false)
  expect(response.values).toEqual({ name: null })
  expect(transport.responses.map((response) => response.kind)).toEqual(['validated'])
})

it('publishes one authoritative structural response with handles and integration metadata', async () => {
  const runtime = new EngineRuntime()
  try {
    const load = dispatch(runtime, {
      kind: 'load',
      requestId: 1,
      preserveState: false,
      initialValues: { people: [{ name: 'Ada' }] },
      sources: [],
      schema: {
        schemaVersion: 'sprout',
        form: [
          {
            type: 'repeater',
            key: 'people',
            min: 1,
            render: { type: 'undereachother', settings: {} },
            template: [{ type: 'text', key: 'people.name' }],
          },
        ],
      },
    })
    expect(load.kind).toBe('loaded')
    const snapshot = vi.spyOn(runtime, 'integration_snapshot')
    const added = dispatch(runtime, {
      kind: 'structure',
      requestId: 2,
      operation: { kind: 'add', key: 'people' },
    })
    expect(added).toMatchObject({
      kind: 'structured',
      state: { repeaters: { people: { length: 2 } } },
      valid: true,
    })
    expect(snapshot).not.toHaveBeenCalled()
    if (added.kind !== 'structured') throw new Error('Expected structure response')
    expect(Object.keys(added.handles!)).toHaveLength(2)
    const validated = dispatch(runtime, { kind: 'validate', requestId: 3 })
    expect(validated).toMatchObject({
      kind: 'validated',
      values: { people: [{ name: 'Ada' }, { name: null }] },
    })
    expect(snapshot).not.toHaveBeenCalled()
  } finally {
    runtime.free()
  }
})

it('renders edits without materializing a full field record when no snapshot consumer needs it', async () => {
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [
      { type: 'text', key: 'name' },
      { type: 'text', key: 'other' },
    ],
  }
  let controller!: EngineClient
  const reads: ReturnType<typeof vi.fn>[] = []
  render(
    <Tungsten
      schema={schema}
      onReady={(client) => {
        controller = client
        client.subscribeChanges((state, changed) => {
          if (!changed) return
          const getter = Object.getOwnPropertyDescriptor(state, 'fields')!.get!
          const read = vi.fn(() => getter.call(state))
          Object.defineProperty(state, 'fields', { enumerable: true, get: read })
          reads.push(read)
        })
      }}
    />,
  )
  await screen.findByLabelText('name')
  const response = await controller.patch({ kind: 'set_value', key: 'name', value: 'Ada' })
  await waitFor(() => expect(screen.getByLabelText('name')).toHaveValue('Ada'))
  expect(reads).toHaveLength(1)
  expect(reads[0]).not.toHaveBeenCalled()
  expect(response.state.fields.name.value).toBe('Ada')
  expect(reads[0]).toHaveBeenCalledTimes(1)
  expect(Object.keys(response.state.fields)).toEqual(['name', 'other'])
})

it('submits and prepares files when randomUUID is unavailable on an ordinary HTTP host', async () => {
  const originalCrypto = crypto
  vi.stubGlobal('crypto', { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) })
  try {
    const submit = vi.fn()
    const schema: TungstenSchema = {
      schemaVersion: 'sprout',
      form: [{ type: 'text', key: 'name', current_value: 'Ready', view: { label: 'Name' } }],
    }
    render(<Tungsten schema={schema} onSubmit={submit} />)
    await screen.findByLabelText('Name')
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: 'Ready' }))
    const request = vi.fn(async () => ({ data: { id: 'durable' } }))
    const c = client(config(request))
    const files = fileSchema()
    await c.load(files)
    await c.selectFiles(files.form[0] as TungstenField, [new File(['x'], 'x.txt')])
    expect((await c.prepareFiles()).valid).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('retains operation initialization failures after schema loading and recovers when configuration is corrected', async () => {
  const submit = vi.fn(),
    ready = vi.fn()
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [{ type: 'text', key: 'name', current_value: 'Ready', view: { label: 'Name' } }],
  }
  const view = render(
    <Tungsten
      schema={schema}
      config={{ autosave: { debounceMs: -1 } }}
      onReady={ready}
      onSubmit={submit}
    />,
  )
  await waitFor(() => expect(ready).toHaveBeenCalled())
  expect(await screen.findByRole('alert')).toHaveTextContent('Autosave debounceMs')
  expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
  view.rerender(
    <Tungsten
      schema={schema}
      config={{ autosave: { debounceMs: 0 } }}
      onReady={ready}
      onSubmit={submit}
    />,
  )
  await screen.findByLabelText('Name')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: 'Ready' }))
})

it.each([false, true])(
  'preserves current source effects through delta recovery (overlapping edit=%s)',
  async (overlap) => {
    const request = vi.fn(async (request: ApiRequest) => {
      const country = new URL(request.url).searchParams.get('country')!
      return { data: [{ value: country, label: country }] }
    })
    const c = client()
    c.configure(config(request), { cities: { api: 'main', endpoint: 'cities' } })
    let current: import('../../../api/src/types.js').FormState | undefined
    c.subscribe((state) => {
      current = state
    })
    await c.load({
      schemaVersion: 'sprout',
      form: [
        { type: 'text', key: 'country', current_value: 'SK' },
        {
          type: 'select',
          key: 'city',
          bindings: { options: { source: 'cities', params: { country: { ref: 'country' } } } },
        },
      ],
    })
    await waitFor(() => expect(current?.fields.city.options?.[0].value).toBe('SK'))
    const before = transport.responses.length
    transport.corrupt = true
    const first = c.patch({ kind: 'set_value', key: 'country', value: 'CZ' })
    const second = overlap
      ? c.patch({ kind: 'set_value', key: 'country', value: 'DE' })
      : Promise.resolve()
    await Promise.all([first, second])
    const expected = overlap ? 'DE' : 'CZ'
    await waitFor(() => expect(current?.fields.city.options?.[0].value).toBe(expected))
    expect(current?.fields.city.loadingSources ?? []).toEqual([])
    expect(
      request.mock.calls.map(([request]) => new URL(request.url).searchParams.get('country')),
    ).toEqual(['SK', expected])
    expect(
      transport.responses.slice(before).filter((response) => response.kind === 'snapshot'),
    ).toHaveLength(1)
    expect((await c.validate()).valid).toBe(true)
  },
)

it.each(['remove', 'replace'])(
  'clears a failed upload when the attachment selection changes: %s',
  async (action) => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Upload failed'))
      .mockResolvedValueOnce({ data: { id: 'durable' } })
    const c = client(config(request))
    const schema = fileSchema()
    const field = schema.form[0] as TungstenField
    field.validators = []
    await c.load(schema)
    await c.selectFiles(field, [new File(['first'], 'first.txt')])
    await expect(c.prepareFiles()).rejects.toThrow('Upload failed')
    expect((await c.validate()).state.fields.attachment.uploadError).toBe('Upload failed')
    if (action === 'remove')
      await c.patch({ kind: 'set_value', key: 'attachment', value: { files: [] } })
    else await c.selectFiles(field, [new File(['second'], 'second.txt')])
    expect((await c.validate()).state.fields.attachment.uploadError).toBeUndefined()
    const prepared = await c.prepareFiles()
    expect(prepared.valid).toBe(true)
    expect(prepared.values).toEqual({
      attachment: {
        files:
          action === 'remove'
            ? []
            : [expect.objectContaining({ id: 'durable', name: 'second.txt', uploaded: true })],
      },
    })
  },
)

it.each([
  { type: 'text' },
  { type: 'number' },
  { type: 'date' },
  { type: 'boolean', variant: 'checkbox' },
  { type: 'boolean', variant: 'switch' },
  { type: 'boolean', variant: 'radio' },
  { type: 'select' },
  { type: 'select', multiple: true },
  { type: 'file', upload: { api: 'main', endpoint: 'files' } },
])(
  'focuses the first invalid read-only field without permitting edits: $type $variant $multiple',
  async (settings) => {
    const submit = vi.fn()
    render(
      <Tungsten
        schema={{
          schemaVersion: 'sprout',
          form: [
            {
              ...settings,
              key: 'answer',
              readOnly: true,
              view: { label: 'Answer' },
              validators: [{ kind: 'required' }],
            },
          ],
        }}
        onSubmit={submit}
      />,
    )
    const button = await screen.findByRole('button', { name: 'Submit' })
    button.focus()
    fireEvent.click(button)
    await waitFor(() => expect(document.activeElement).toHaveAttribute('name'))
    expect(document.activeElement).toHaveAttribute('aria-invalid', 'true')
    expect(submit).not.toHaveBeenCalled()
  },
)

it('preserves stored dates and emits no engine edits when switching to Thai and Arabic', async () => {
  const schema: TungstenSchema = {
    schemaVersion: 'sprout',
    form: [{ type: 'date', key: 'day', current_value: '2026-10-10', view: { label: 'Day' } }],
  }
  const state = vi.fn(),
    submit = vi.fn()
  const view = render(
    <Tungsten schema={schema} language="en" onStateChange={state} onSubmit={submit} />,
  )
  await screen.findByLabelText('Day')
  await waitFor(() => expect(state).toHaveBeenCalled())
  const emissions = state.mock.calls.length,
    commands = transport.responses.length
  for (const language of ['th-TH', 'ar-EG']) {
    view.rerender(
      <Tungsten schema={schema} language={language} onStateChange={state} onSubmit={submit} />,
    )
    const input = screen.getByLabelText('Day')
    await waitFor(() =>
      expect(input).toHaveValue(dateDisplayValue('2026-10-10', { mode: 'date' }, language)),
    )
    expect((input as HTMLInputElement).value).toContain('2026')
    expect(state).toHaveBeenCalledTimes(emissions)
    expect(transport.responses).toHaveLength(commands)
  }
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith({ day: '2026-10-10' }))
})
