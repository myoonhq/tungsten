import type { Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { arch, cpus, platform, release, totalmem } from 'node:os'

interface WorkerSample {
  command: string
  kind: string
  ackMs: number
  fields: number
  fullState: boolean
  jsonBytes?: number
}
declare global {
  interface Window {
    benchmark: {
      created: number
      active: number
      samples: WorkerSample[]
    }
  }
}
export async function observeWorkers(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const stats = { created: 0, active: 0, samples: [] as WorkerSample[] }
    window.benchmark = stats
    window.Worker = class extends NativeWorker {
      pending = new Map<number, { command: string; at: number }>()
      disposed = false
      measuredPayload = false
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        stats.created++
        stats.active++
        this.addEventListener('message', (event) => {
          const response = event.data as {
            requestId: number
            kind: string
            fields?: Record<string, unknown>
            state?: unknown
          }
          const sent = this.pending.get(response.requestId)
          if (!sent) return
          this.pending.delete(response.requestId)
          const sample: WorkerSample = {
            command: sent.command,
            kind: response.kind,
            ackMs: performance.now() - sent.at,
            fields: Object.keys(response.fields ?? {}).length,
            fullState: 'state' in response,
          }
          // Estimate JSON size once, outside measured samples (during warmup).
          if (response.kind === 'delta' && !this.measuredPayload) {
            sample.jsonBytes = new TextEncoder().encode(JSON.stringify(response)).length
            this.measuredPayload = true
          }
          stats.samples.push(sample)
          if (stats.samples.length > 1000) stats.samples.shift()
        })
      }
      override postMessage(
        message: unknown,
        options: Transferable[] | StructuredSerializeOptions = [],
      ) {
        const command = message as { requestId: number; kind: string }
        this.pending.set(command.requestId, { command: command.kind, at: performance.now() })
        if (Array.isArray(options)) super.postMessage(message, options)
        else super.postMessage(message, options)
      }
      override terminate() {
        if (!this.disposed) {
          this.disposed = true
          stats.active--
          this.pending.clear()
        }
        super.terminate()
      }
    }
  })
}
export function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
    samples: values,
  }
}
export function report(name: string, browser: string, design: string, data: object) {
  const artifacts = resolve(import.meta.dirname, '../../.artifacts')
  const artifact = JSON.parse(
    readFileSync(resolve(artifacts, 'tungsten-browser-consumer/artifact.json'), 'utf8'),
  )
  const result = {
    measuredAt: new Date().toISOString(),
    artifact,
    browser,
    design,
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryGiB: totalmem() / 1024 ** 3,
    },
    percentile: 'nearest-rank',
    ...data,
  }
  const json = JSON.stringify(result, null, 2)
  writeFileSync(resolve(artifacts, `tungsten-${name}-benchmark.json`), json)
  return json
}
export async function measureEdits(page: Page, lastAffected = 1, samples = 20) {
  return page.evaluate(
    async ({ lastAffected, samples }) => {
      const fixture = window.fixture
      const input = document.querySelector<HTMLInputElement>('input[name="field_0"]')!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      const rows = []
      // Repeated diagnostic passes must start with a change, not a no-op patch.
      const offset = fixture.snapshot?.values.field_0 === 'even' ? 1 : 0
      for (let index = 0; index < samples + 5; index++) {
        const value = (index + offset) % 2 ? 'odd' : 'even'
        const before = { ...fixture.renders }
        let timer: ReturnType<typeof setTimeout>
        const settled = new Promise<void>((resolve, reject) => {
          const notify = () => {
            if (fixture.snapshot?.values[`field_${lastAffected}`] !== value) return
            fixture.notifications.delete(notify)
            clearTimeout(timer)
            resolve()
          }
          timer = setTimeout(() => {
            fixture.notifications.delete(notify)
            reject(new Error('Benchmark edit did not settle'))
          }, 20_000)
          fixture.notifications.add(notify)
        })
        const started = performance.now()
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settled
        const stateMs = fixture.snapshotAt - started
        const acknowledged = window.benchmark.samples.at(-1)!
        const committedInput = input.value === value
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        if (index >= 5)
          rows.push({
            stateMs,
            frameBoundaryMs: performance.now() - started,
            ackMs: acknowledged.ackMs,
            deltaFields: acknowledged.fields,
            fullState: acknowledged.fullState,
            kind: acknowledged.kind,
            committedInput,
            unrelatedRenders: Object.entries(fixture.renders)
              .filter(([key]) => {
                const field = Number(key.slice('field_'.length))
                return field > lastAffected
              })
              .reduce((sum, [key, count]) => sum + count - (before[key] ?? 0), 0),
          })
      }
      return {
        rows,
        values: fixture.snapshot!.values,
        valid: fixture.snapshot!.valid,
        payload: window.benchmark.samples.find((sample) => sample.jsonBytes)?.jsonBytes,
      }
    },
    { lastAffected, samples },
  )
}
