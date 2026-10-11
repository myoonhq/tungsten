import { test, expect } from '../fixtures.js'
import { measureEdits, observeWorkers, report, summary } from '../benchmark-tools.js'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface ProfileSample {
  sentAt: number
  receivedAt: number
  workerMs: number
  receiveMs: number
  fields: number
  fullState: boolean
}
declare global {
  interface Window {
    slowdown: {
      worker: Worker
      latest: ProfileSample
      raw: Map<number, (response: { fields: Record<string, { value: unknown }> }) => void>
    }
  }
}

test('attribute fixed two-field edits to worker, client and React at four sizes', async ({
  page,
  session: fixtureSession,
  browser,
  design,
}, info) => {
  // Bootstrap the existing packed classic worker. Time only event receipt to
  // response inside the worker; carry the duration as ignored diagnostic metadata.
  // Production source and protocol behavior are otherwise unchanged.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const stats = {
      worker: null as unknown as Worker,
      latest: null as unknown as ProfileSample,
      raw: new Map<number, (response: { fields: Record<string, { value: unknown }> }) => void>(),
    }
    window.slowdown = stats
    window.Worker = class extends NativeWorker {
      pending = new Map<number, number>()
      constructor(url: string | URL, options?: WorkerOptions) {
        if (options?.type === 'module')
          throw new Error('Profiler requires the packed classic worker')
        const source = `let started = 0;
          self.addEventListener('message', () => { started = performance.now(); });
          const nativePost = self.postMessage.bind(self);
          self.postMessage = (data, ...args) => nativePost({ ...data, __profileWorkerMs: performance.now() - started }, ...args);
          importScripts(${JSON.stringify(String(url))});`
        const bootstrap = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
        super(bootstrap, options)
        stats.worker = this
        const setter = Object.getOwnPropertyDescriptor(NativeWorker.prototype, 'onmessage')!.set!
        Object.defineProperty(this, 'onmessage', {
          set: (handler: ((this: Worker, event: MessageEvent) => unknown) | null) => {
            setter.call(
              this,
              handler &&
                ((event: MessageEvent) => {
                  const started = performance.now()
                  try {
                    handler.call(this, event)
                  } finally {
                    stats.latest.receiveMs = performance.now() - started
                  }
                }),
            )
          },
        })
        this.addEventListener('message', (event) => {
          const response = event.data
          const sentAt = this.pending.get(response.requestId)
          if (sentAt === undefined) return
          this.pending.delete(response.requestId)
          stats.latest = {
            sentAt,
            receivedAt: performance.now(),
            workerMs: response.__profileWorkerMs,
            receiveMs: 0,
            fields: Object.keys(response.fields ?? {}).length,
            fullState: 'state' in response,
          }
          const resolve = stats.raw.get(response.requestId)
          if (resolve) {
            stats.raw.delete(response.requestId)
            resolve(response)
          }
        })
      }
      override postMessage(
        message: unknown,
        options: Transferable[] | StructuredSerializeOptions = [],
      ) {
        this.pending.set((message as { requestId: number }).requestId, performance.now())
        if (Array.isArray(options)) super.postMessage(message, options)
        else super.postMessage(message, options)
      }
    }
  })
  const open = async (_scenario: string, options: Record<string, string>) => {
    console.log('Profiling', options)
    await page.goto(
      `/?${new URLSearchParams({ scenario: 'benchmark', design, session: fixtureSession, ...options })}`,
    )
    await expect
      .poll(() => page.evaluate(() => !!window.fixture?.snapshot), { timeout: 20000 })
      .toBe(true)
  }
  const results = []
  for (const count of [10, 100, 1000, 10000]) {
    // Raw worker probe intentionally bypasses the client. Reload before UI tests
    // so there is no revision mismatch or recovery mixed into those measurements.
    await open('benchmark', { count: String(count), mounted: '100', limit: '1000' })
    const workerOnly = await page.evaluate(async () => {
      const rows = []
      for (let index = 0; index < 120; index++) {
        const requestId = 100000 + index
        const value = index % 2 ? 'odd' : 'even'
        const response = await new Promise<{ fields: Record<string, { value: unknown }> }>(
          (resolve) => {
            window.slowdown.raw.set(requestId, resolve)
            window.slowdown.worker.postMessage({
              requestId,
              kind: 'patch',
              patch: { kind: 'set_value', key: 'field_0', value },
            })
          },
        )
        if (response.fields.field_1?.value !== value)
          throw new Error('Raw dependency did not update')
        if (index >= 20) rows.push({ ...window.slowdown.latest })
      }
      return rows
    })
    for (const row of workerOnly) expect(row).toMatchObject({ fields: 2, fullState: false })
    for (const mounted of [...new Set([Math.min(count, 100), count])]) {
      for (const method of ['input', 'controller'] as const) {
        await open('benchmark', { count: String(count), mounted: String(mounted), limit: '1000' })
        const session =
          count === 10000 && mounted === count && method === 'input'
            ? await page.context().newCDPSession(page)
            : null
        if (session) {
          await session.send('Profiler.enable')
          await session.send('Profiler.start')
        }
        const rows = await page.evaluate(async (method) => {
          const fixture = window.fixture
          const input = document.querySelector<HTMLInputElement>('input[name="field_0"]')!
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
          const rows = []
          for (let index = 0; index < 35; index++) {
            const value = index % 2 ? 'odd' : 'even'
            const settled = new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                fixture.notifications.delete(notify)
                reject(new Error('Edit did not settle'))
              }, 20000)
              const notify = () => {
                if (fixture.snapshot?.values.field_1 !== value) return
                fixture.notifications.delete(notify)
                clearTimeout(timer)
                resolve()
              }
              fixture.notifications.add(notify)
            })
            const started = performance.now()
            if (method === 'input') {
              setter.call(input, value)
              input.dispatchEvent(new Event('input', { bubbles: true }))
            } else {
              void fixture.controller!.patch({ kind: 'set_value', key: 'field_0', value })
            }
            const triggerMs = performance.now() - started
            await settled
            const sample = { ...window.slowdown.latest }
            if (index >= 5)
              rows.push({
                ...sample,
                triggerMs,
                stateMs: fixture.snapshotAt - started,
                beforeSendMs: sample.sentAt - started,
                roundTripMs: sample.receivedAt - sample.sentAt,
                afterReceiveMs: fixture.snapshotAt - sample.receivedAt,
              })
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            )
          }
          return rows
        }, method)
        if (session) {
          const { profile } = await session.send('Profiler.stop')
          writeFileSync(
            resolve(
              import.meta.dirname,
              '../../../.artifacts/tungsten-main-thread.cpuprofile',
            ),
            JSON.stringify(profile),
          )
          await session.detach()
        }
        for (const row of rows) expect(row).toMatchObject({ fields: 2, fullState: false })
        console.log(count, mounted, method, summary(rows.map((row) => row.stateMs)).p95)
        results.push({
          count,
          mounted,
          method,
          workerOnly: {
            workerMs: summary(workerOnly.map((row) => row.workerMs)),
            roundTripMs: summary(workerOnly.map((row) => row.receivedAt - row.sentAt)),
          },
          stages: Object.fromEntries(
            [
              'triggerMs',
              'beforeSendMs',
              'workerMs',
              'roundTripMs',
              'receiveMs',
              'afterReceiveMs',
              'stateMs',
            ].map((stage) => [
              stage,
              summary(rows.map((row) => row[stage as keyof typeof row] as number)),
            ]),
          ),
        })
      }
    }
  }
  const json = report('slowdown-profile', browser.version(), design, {
    sampleCount: 30,
    warmups: 5,
    workerOnlySamples: 100,
    workerOnlyWarmups: 20,
    methodology:
      'Diagnostic packed-worker bootstrap; raw worker bypass versus host input/controller. Worker duration includes dispatch, JSON, WASM and warning extraction, excludes transport. Client handler duration includes merge and synchronous listeners. Host remainder includes scheduling, React render/commit and snapshot effects. Main-thread CPU sampling enabled only for 10k visible input; overhead affects that row. No production optimization.',
    results,
  })
  await info.attach('slowdown-profile.json', { body: json, contentType: 'application/json' })
})

test('separate browser layout from the normal packed edit path', async ({
  page,
  open,
  browser,
  design,
}, info) => {
  await observeWorkers(page)
  const results = []
  for (const mounted of [100, 10000]) {
    await open('benchmark', { count: '10000', mounted: String(mounted), limit: '1000' })
    for (const css of ['normal', 'disabled'] as const) {
      if (css === 'disabled')
        await page.evaluate(() => {
          for (const sheet of document.styleSheets) sheet.disabled = true
        })
      const measured = await measureEdits(page, 1, 20)
      for (const row of measured.rows)
        expect(row).toMatchObject({
          deltaFields: 2,
          fullState: false,
          unrelatedRenders: 0,
          committedInput: true,
        })
      results.push({
        mounted,
        css,
        stateMs: summary(measured.rows.map((row) => row.stateMs)),
        roundTripMs: summary(measured.rows.map((row) => row.ackMs)),
      })
    }
  }
  const session = await page.context().newCDPSession(page)
  await page.evaluate(async () => {
    for (const sheet of document.styleSheets) sheet.disabled = false
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => {})),
    )
  })
  await session.send('Tracing.start', {
    categories: 'devtools.timeline',
    transferMode: 'ReturnAsStream',
  })
  await measureEdits(page, 1, 10)
  const completed = new Promise<{ stream?: string }>((resolve) =>
    session.once('Tracing.tracingComplete', resolve),
  )
  await session.send('Tracing.end')
  const { stream } = await completed
  if (!stream) throw new Error('Trace stream unavailable')
  let content = ''
  while (true) {
    const chunk = await session.send('IO.read', { handle: stream })
    content += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data
    if (chunk.eof) break
  }
  await session.send('IO.close', { handle: stream })
  writeFileSync(
    resolve(import.meta.dirname, '../../../.artifacts/tungsten-layout-trace.json'),
    content,
  )
  await session.detach()
  const json = report('slowdown-layout', browser.version(), design, {
    sampleCount: 20,
    warmups: 5,
    methodology:
      'Unmodified packed worker and library. Same two-field input edits with 100 versus 10000 mounted controls, then page styles temporarily disabled. Timing excludes trace; timeline captured in a separate final 10-sample run. CSS-disabled controls retain native browser styles. This is a diagnostic intervention, not a product fix.',
    results,
  })
  await info.attach('slowdown-layout.json', { body: json, contentType: 'application/json' })
})

test('profile edits without a full-state consumer', async ({ page, open }) => {
  await open('benchmark', { count: '10000', mounted: '10000', observe: 'none' })
  const session = await page.context().newCDPSession(page)
  await session.send('Profiler.enable')
  await session.send('Profiler.start')
  await session.send('Tracing.start', {
    categories: 'devtools.timeline',
    transferMode: 'ReturnAsStream',
  })
  await page.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      const value = i % 2 ? 'odd' : 'even'
      await window.fixture.controller!.patch({ kind: 'set_value', key: 'field_0', value })
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(check)
        function check() {
          if (document.querySelector<HTMLInputElement>('input[name="field_1"]')!.value === value) {
            observer.disconnect()
            resolve()
          }
        }
        observer.observe(document.body, { subtree: true, attributes: true, childList: true })
        check()
      })
    }
  })
  const { profile } = await session.send('Profiler.stop')
  writeFileSync(
    resolve(import.meta.dirname, '../../../.artifacts/tungsten-unobserved.cpuprofile'),
    JSON.stringify(profile),
  )
  const completed = new Promise<{ stream?: string }>((resolve) =>
    session.once('Tracing.tracingComplete', resolve),
  )
  await session.send('Tracing.end')
  const { stream } = await completed
  if (!stream) throw new Error('Trace stream unavailable')
  let content = ''
  while (true) {
    const chunk = await session.send('IO.read', { handle: stream })
    content += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data
    if (chunk.eof) break
  }
  await session.send('IO.close', { handle: stream })
  writeFileSync(
    resolve(import.meta.dirname, '../../../.artifacts/tungsten-unobserved-trace.json'),
    content,
  )
  await session.detach()
})
