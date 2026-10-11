import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '../fixtures.js'

function percentile(values: number[], quantile: number) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1]
}

test('Stress / PERF-01: comparable input→worker/WASM→React paint at 10/100/1,000/10,000 fields @stress', async ({
  open,
  page,
  browser,
  design,
}, info) => {
  const results = []
  for (const count of [10, 100, 1000, 10000]) {
    const start = Date.now()
    await open('benchmark', { count: String(count) })
    const initializationMs = Date.now() - start
    const measurements = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('input[name="field_0"]')!
      const dependent = document.querySelector<HTMLInputElement>('input[name="field_1"]')!
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      const latencies: number[] = []
      const renders: Record<string, number>[] = []
      for (let index = 0; index < 110; index++) {
        const value = index % 2 ? 'odd' : 'even'
        const before = { ...window.fixture.renders }
        const started = performance.now()
        set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise<void>((resolve, reject) => {
          const deadline = started + 5000
          const check = () => {
            if (performance.now() > deadline)
              return reject(new Error(`Edit ${index} did not settle`))
            if (window.fixture.snapshot?.values.field_1 === value && dependent.value === value) {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            } else requestAnimationFrame(check)
          }
          check()
        })
        if (index >= 10) {
          latencies.push(performance.now() - started)
          renders.push(
            Object.fromEntries(
              Object.entries(window.fixture.renders)
                .map(([key, value]) => [key, value - (before[key] ?? 0)])
                .filter(([, value]) => Number(value) > 0),
            ),
          )
        }
      }
      return {
        latencies,
        renders,
        finalValues: window.fixture.snapshot!.values,
        valid: window.fixture.snapshot!.valid,
      }
    })
    expect(Object.keys(measurements.finalValues)).toHaveLength(count)
    expect(measurements.finalValues.field_0).toBe('odd')
    expect(measurements.finalValues.field_1).toBe('odd')
    expect(measurements.valid).toBe(true)
    results.push({
      count,
      mountedControls: Math.min(count, 100),
      initializationMs,
      p50: percentile(measurements.latencies, 0.5),
      p95: percentile(measurements.latencies, 0.95),
      max: Math.max(...measurements.latencies),
      unrelatedRenders: measurements.renders.reduce(
        (sum, row) =>
          sum +
          Object.entries(row)
            .filter(([key]) => key !== 'field_0' && key !== 'field_1')
            .reduce((n, [, count]) => n + count, 0),
        0,
      ),
      samples: measurements.latencies,
    })
  }
  const artifact = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        '../../../.artifacts/tungsten-browser-consumer/artifact.json',
      ),
      'utf8',
    ),
  )
  const report = JSON.stringify(
    {
      artifact,
      browser: browser.version(),
      design,
      platform: process.platform,
      arch: process.arch,
      sampleCount: 100,
      percentile: 'nearest-rank',
      fixture: 'mixed fields; fixed two-field affected graph; at most 100 mounted controls',
      results,
    },
    null,
    2,
  )
  writeFileSync(
    resolve(import.meta.dirname, '../../../.artifacts/tungsten-integrated-benchmark.json'),
    report,
  )
  await info.attach('integrated-benchmark.json', { body: report, contentType: 'application/json' })
  // Exact work assertions and a coarse latency ceiling belong in normal CI.
  // Tight budgets still require calibration on the declared reference runner.
  expect(
    results.map((row) => ({ count: row.count, unrelatedRenders: row.unrelatedRenders })),
    'PERF-01: unrelated controls must not rerender on an isolated edit',
  ).toEqual(results.map((row) => ({ count: row.count, unrelatedRenders: 0 })))
  {
    const budget = Number(process.env.TUNGSTEN_EDIT_OVERHEAD_MS ?? 100)
    expect(Number.isFinite(budget) && budget >= 0).toBe(true)
    expect(results.at(-1)!.p95 - results[0].p95).toBeLessThanOrEqual(budget)
  }
})

test('Stress / PERF-02: 10,000 visible mixed controls initialize, edit and submit complete values @stress', async ({
  open,
  page,
  driver,
}, info) => {
  const started = Date.now()
  await open('benchmark', { count: '10000', mounted: '10000', limit: '1000' })
  await expect
    .poll(() => page.evaluate(() => Object.keys(window.fixture.renders).length))
    .toBe(10000)
  const initializationMs = Date.now() - started
  const input = driver.textInput('field_0')
  // Verify labeling on the resolved control instead of scanning every element's labels.
  await expect(input).toHaveAccessibleName('field_0')
  await input.fill('even')
  await expect
    .poll(() => page.evaluate(() => window.fixture.snapshot?.state.fields.field_1.value))
    .toBe('even')
  await expect(driver.textInput('field_1')).toHaveValue('even')
  // A real click scrolls through the 10,000-control document and completes
  // browser work on shared CI runners. This is a liveness bound, not an edit budget.
  const submissionStarted = Date.now()
  await driver.submit().click({ timeout: 60_000 })
  await expect
    .poll(() => page.evaluate(() => window.fixture.submissions.length), {
      timeout: 60_000,
      message: 'PERF-02: the real submit click must produce exactly one completed submission',
    })
    .toBe(1)
  const submissionMs = Date.now() - submissionStarted
  const values = await page.evaluate(() => window.fixture.submissions[0])
  expect(Object.keys(values)).toHaveLength(10000)
  expect(values).toMatchObject({ field_0: 'even', field_1: 'even', field_9999: 'ready' })
  const report = JSON.stringify(
    {
      count: 10000,
      mountedControls: 10000,
      initializationMs,
      submissionMs,
      submittedValueCount: Object.keys(values).length,
    },
    null,
    2,
  )
  writeFileSync(
    resolve(import.meta.dirname, '../../../.artifacts/tungsten-visible-large-form.json'),
    report,
  )
  await info.attach('visible-large-form.json', { body: report, contentType: 'application/json' })
})
