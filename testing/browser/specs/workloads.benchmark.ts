import { test, expect } from '../fixtures.js'
import { measureEdits, observeWorkers, report, summary } from '../benchmark-tools.js'

// Timing is observational until reference-runner budgets are approved. These
// bounded tests gate correct outcomes, delta work and worker cleanup.
test('Stress / PERF-03: all controls mounted, isolated edits and narrow deltas at four form sizes @stress', async ({
  page,
  open,
  browser,
  design,
}, info) => {
  await observeWorkers(page)
  const results = []
  for (const count of [10, 100, 1000, 10000]) {
    await open('benchmark', { count: String(count), mounted: String(count), limit: '1000' })
    const initialization = await page.evaluate(() => ({
      readyMs: window.fixture.readyAt - window.fixture.startedAt,
      mountedControls: Object.keys(window.fixture.renders).length,
    }))
    expect(initialization.mountedControls).toBe(count)
    const measured = await measureEdits(page)
    expect(measured.valid).toBe(true)
    expect(Object.keys(measured.values)).toHaveLength(count)
    expect(measured.values.field_0).toBe('even')
    expect(measured.values.field_1).toBe('even')
    for (const row of measured.rows)
      expect(row).toMatchObject({
        deltaFields: 2,
        fullState: false,
        kind: 'delta',
        committedInput: true,
        unrelatedRenders: 0,
      })
    results.push({
      count,
      ...initialization,
      stateReadyMs: summary(measured.rows.map((row) => row.stateMs)),
      workerRoundTripMs: summary(measured.rows.map((row) => row.ackMs)),
      frameBoundaryMs: summary(measured.rows.map((row) => row.frameBoundaryMs)),
      deltaJsonBytes: measured.payload,
      unrelatedRenders: 0,
    })
  }
  const json = report('visible-edits', browser.version(), design, {
    sampleCount: 20,
    warmups: 5,
    fixture:
      'all mixed controls mounted; fixed two-field affected graph; state callback after React commit; two animation frames recorded separately',
    results,
  })
  await info.attach('visible-edits.json', { body: json, contentType: 'application/json' })
})

test('Stress / PERF-04: growing fan-out and finite dependency chains remain correct in 10,000 fields @stress', async ({
  page,
  open,
  browser,
  design,
}, info) => {
  await observeWorkers(page)
  const results = []
  for (const [shape, affected] of [
    ['fanout', 10],
    ['fanout', 100],
    ['fanout', 1000],
    ['chain', 10],
    ['chain', 50],
  ] as const) {
    await open(`benchmark-${shape}`, {
      count: '10000',
      mounted: '100',
      affected: String(affected),
      limit: '100000',
    })
    const measured = await measureEdits(page, affected)
    expect(measured.valid).toBe(true)
    for (let index = 0; index <= affected; index++)
      expect(measured.values[`field_${index}`]).toBe('even')
    expect(measured.values.field_9999).toBe('ready')
    for (const row of measured.rows)
      expect(row).toMatchObject({
        deltaFields: affected + 1,
        fullState: false,
        kind: 'delta',
        unrelatedRenders: 0,
      })
    results.push({
      shape,
      totalFields: 10000,
      mountedControls: 100,
      affectedFields: affected + 1,
      stateReadyMs: summary(measured.rows.map((row) => row.stateMs)),
      workerRoundTripMs: summary(measured.rows.map((row) => row.ackMs)),
      deltaJsonBytes: measured.payload,
    })
  }
  const json = report('dependencies', browser.version(), design, {
    sampleCount: 20,
    warmups: 5,
    fixture:
      'explicit opposite rules; finite graph; processing budget 100,000 for the workload, not the default',
    results,
  })
  await info.attach('dependencies.json', { body: json, contentType: 'application/json' })
})

test('Stress / PERF-05: full validation, file preparation, reset, submission and debounced draft capture @stress', async ({
  page,
  open,
  browser,
  design,
}, info) => {
  await observeWorkers(page)
  await open('benchmark', { count: '10000', mounted: '100', limit: '1000', autosave: 'true' })
  const measurements = await page.evaluate(async () => {
    const fixture = window.fixture
    const controller = fixture.controller!
    const validation = [],
      preparation = [],
      reset = [],
      submission = []
    const wait = (predicate: () => boolean) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          fixture.notifications.delete(notify)
          reject(new Error('Whole-form benchmark did not settle'))
        }, 20_000)
        const notify = () => {
          if (predicate()) {
            clearTimeout(timer)
            fixture.notifications.delete(notify)
            resolve()
          }
        }
        fixture.notifications.add(notify)
        notify()
      })
    for (let index = 0; index < 6; index++) {
      let started = performance.now()
      const validated = await controller.validate()
      if (!validated.valid || Object.keys(validated.values ?? {}).length !== 10000)
        throw new Error('Incomplete validation')
      if (index) validation.push(performance.now() - started)
      started = performance.now()
      const prepared = await controller.prepareFiles()
      if (!prepared.valid || Object.keys(prepared.values ?? {}).length !== 10000)
        throw new Error('Incomplete prepared values')
      if (index) preparation.push(performance.now() - started)
      await controller.patch({ kind: 'set_value', key: 'field_0', value: 'odd' })
      await wait(() => fixture.snapshot?.values.field_1 === 'odd')
      started = performance.now()
      await controller.reset()
      await wait(() => fixture.snapshot?.values.field_0 === 'ready')
      if (fixture.snapshot?.values.field_1 !== 'ready')
        throw new Error('Reset did not restore defaults')
      if (index) reset.push(performance.now() - started)
      const before = fixture.submissions.length
      started = performance.now()
      document.querySelector('form')!.requestSubmit()
      await wait(() => fixture.submissions.length === before + 1)
      if (Object.keys(fixture.submissions.at(-1)!).length !== 10000)
        throw new Error('Incomplete HTTP submission')
      if (index) submission.push(performance.now() - started)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    }
    const before = fixture.saves.length
    const started = performance.now()
    await controller.patch({ kind: 'set_value', key: 'field_0', value: 'even' })
    await wait(
      () => fixture.saves.length > before && fixture.saves.at(-1)?.values.field_1 === 'even',
    )
    const save = fixture.saves.at(-1)!
    return {
      validation,
      preparation,
      reset,
      submission,
      draft: {
        editToHostCallbackMs: save.at - started,
        debounceMs: 200,
        valueCount: Object.keys(save.values).length,
      },
    }
  })
  expect(measurements.draft.valueCount).toBe(10000)
  expect(measurements.draft.editToHostCallbackMs).toBeGreaterThanOrEqual(190)
  const json = report('whole-form', browser.version(), design, {
    count: 10000,
    mountedControls: 100,
    samples: 5,
    warmups: 1,
    validationMs: summary(measurements.validation),
    prepareWithoutFilesMs: summary(measurements.preparation),
    resetToCommittedStateMs: summary(measurements.reset),
    submitToLocalHTTPCallbackMs: summary(measurements.submission),
    draft: measurements.draft,
  })
  await info.attach('whole-form.json', { body: json, contentType: 'application/json' })
})

test('Stress / PERF-06: 10,000 nested repeater leaves edit, reorder, add and remove without losing identity @stress', async ({
  page,
  open,
  browser,
  design,
}, info) => {
  await observeWorkers(page)
  await open('benchmark-repeater', { count: '10000', limit: '100000' })
  const measurements = await page.evaluate(async () => {
    const fixture = window.fixture
    const controller = fixture.controller!
    const wait = (predicate: () => boolean) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          fixture.notifications.delete(notify)
          reject(new Error('Repeater benchmark did not settle'))
        }, 20_000)
        const notify = () => {
          if (predicate()) {
            clearTimeout(timer)
            fixture.notifications.delete(notify)
            resolve()
          }
        }
        fixture.notifications.add(notify)
        notify()
      })
    const readyMs = fixture.readyAt - fixture.startedAt
    const mountedControls = Object.keys(fixture.renders).length
    const original = document.querySelector('input[name="people[999].name"]')
    const values = () =>
      fixture.snapshot!.values.people as { name: string; children: { name: string }[] }[]
    const rows: { operation: string; acknowledgmentMs: number; committedStateMs: number }[] = []
    const measure = async (
      operation: string,
      execute: () => Promise<unknown>,
      predicate: () => boolean,
    ) => {
      const started = performance.now()
      await execute()
      const acknowledgmentMs = performance.now() - started
      await wait(predicate)
      rows.push({ operation, acknowledgmentMs, committedStateMs: performance.now() - started })
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    }
    await measure(
      'reorder parent last→first',
      () => controller.reorderInstance('people', 999, 0),
      () => values()[0].name === 'person-999',
    )
    const retainedDOM =
      original !== null && document.querySelector('input[name="people[0].name"]') === original
    const childRetained = values()[0].children[0].name === 'child-999-0'
    await measure(
      'edit nested child',
      () =>
        controller.patch({
          kind: 'set_value',
          key: 'people[0].children[0].name',
          value: 'edited child',
        }),
      () => values()[0].children[0].name === 'edited child',
    )
    const editDelta = window.benchmark.samples.at(-1)!
    await measure(
      'add nested child',
      () => controller.addInstance('people[0].children'),
      () => values()[0].children.length === 3,
    )
    await measure(
      'remove nested child',
      () => controller.removeInstance('people[0].children', 2),
      () => values()[0].children.length === 2,
    )
    const validated = await controller.validate()
    return {
      readyMs,
      mountedControls,
      retainedDOM,
      childRetained,
      editDelta,
      rows,
      finalFields: Object.keys(fixture.snapshot!.state.fields).length,
      valid: validated.valid,
      parentRows: values().length,
    }
  })
  expect(measurements).toMatchObject({
    mountedControls: 10000,
    retainedDOM: true,
    childRetained: true,
    finalFields: 10000,
    valid: true,
    parentRows: 1000,
  })
  expect(measurements.editDelta).toMatchObject({ kind: 'delta', fields: 1, fullState: false })
  const json = report('nested-repeater', browser.version(), design, {
    samplesPerOperation: 1,
    fixture:
      '1,000 parent rows; two child rows each; 10,000 visible text/number/boolean/select leaves; structural responses may contain full state',
    ...measurements,
  })
  await info.attach('nested-repeater.json', { body: json, contentType: 'application/json' })
})

test('Stress / PERF-07: repeated mount/unmount terminates workers and records retained main-thread heap @stress', async ({
  page,
  open,
  browser,
  design,
}, info) => {
  await observeWorkers(page)
  await open('benchmark', { count: '1000', mounted: '100', limit: '1000' })
  const cdp = await page.context().newCDPSession(page)
  async function heap() {
    await cdp.send('HeapProfiler.collectGarbage')
    return (await cdp.send('Runtime.getHeapUsage')).usedSize as number
  }
  const activeHeapBytes = await heap()
  await page.evaluate(() => window.fixture.mount(false))
  await expect.poll(() => page.evaluate(() => window.benchmark.active)).toBe(0)
  const baselineHeapBytes = await heap()
  const cycles = []
  for (let index = 0; index < 10; index++) {
    const started = Date.now()
    await page.evaluate(() => window.fixture.mount(true))
    await expect.poll(() => page.evaluate(() => window.fixture.snapshot !== null)).toBe(true)
    await page.evaluate(() => window.fixture.mount(false))
    await expect.poll(() => page.evaluate(() => window.benchmark.active)).toBe(0)
    cycles.push({ elapsedMs: Date.now() - started, heapBytes: await heap() })
  }
  const workers = await page.evaluate(() => window.benchmark)
  expect(workers.created).toBe(11)
  expect(workers.active).toBe(0)
  await cdp.detach()
  const json = report('lifecycle', browser.version(), design, {
    count: 1000,
    mountedControls: 100,
    cycles,
    activeHeapBytes,
    baselineHeapBytes,
    retainedGrowthBytes: cycles.at(-1)!.heapBytes - baselineHeapBytes,
    createdWorkers: workers.created,
    activeWorkersAfterUnmount: workers.active,
    memoryScope:
      'Chromium main-thread JS heap after forced GC; excludes worker/WASM/native/DOM/process memory; informational, not a leak-free claim',
  })
  await info.attach('lifecycle.json', { body: json, contentType: 'application/json' })
})

test('Stress / PERF-08: 10,000 API-loaded select options reconcile, open and select the last value @stress', async ({
  page,
  open,
  browser,
  design,
  driver,
}, info) => {
  await observeWorkers(page)
  await open('benchmark-options')
  await expect
    .poll(() => page.evaluate(() => window.fixture.snapshot?.state.fields.choices.options?.length))
    .toBe(10000)
  const sourceReadyMs = await page.evaluate(
    () => window.fixture.snapshotAt - window.fixture.startedAt,
  )
  const opened = await page.evaluate(async () => {
    const started = performance.now()
    const observerReady = new Promise<void>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('[role="option"][aria-setsize="10001"]')) {
          clearTimeout(timer)
          observer.disconnect()
          resolve()
        }
      })
      const timer = setTimeout(() => {
        observer.disconnect()
        reject(new Error('Large options menu did not render'))
      }, 20_000)
      observer.observe(document.body, { subtree: true, childList: true })
    })
    ;(document.querySelector('[role="combobox"]') as HTMLElement).click()
    await observerReady
    return performance.now() - started
  })
  await page.getByRole('combobox', { name: 'Choices', exact: true }).press('End')
  const mountedOptions = await page.getByRole('option').count()
  expect(mountedOptions).toBeLessThan(60)
  await driver.select('Choices', 'Option 9999')
  await expect
    .poll(() => page.evaluate(() => window.fixture.snapshot?.values.choices))
    .toBe('option-9999')
  const json = report('options', browser.version(), design, {
    optionCount: 10000,
    mountedOptions,
    samplesPerOperation: 1,
    sourceReadyMs,
    menuDOMReadyMs: opened,
    selectedValue: 'option-9999',
    fixture:
      'real local HTTP JSON, response-schema validation and core reconciliation; 10,000 options with a bounded variable-height menu window; last option reached by keyboard; excludes production network latency',
  })
  await info.attach('options.json', { body: json, contentType: 'application/json' })
})

test('Stress / PERF-09: switching a 10,000-key language catalog preserves 10,000 visible values without core traffic @stress', async ({
  page,
  open,
  browser,
  design,
}, info) => {
  await observeWorkers(page)
  await open('benchmark-language', { count: '10000', mounted: '10000', limit: '1000' })
  const measured = await page.evaluate(async () => {
    const emissions = window.fixture.emissions
    const commands = window.benchmark.samples.length
    const first = document.querySelector<HTMLInputElement>('input[name="field_0"]')!
    const last = document.querySelector<HTMLInputElement>('input[name="field_9999"]')!
    const timings = []
    for (let index = 0; index < 6; index++) {
      const translated = index % 2 === 0
      const label = translated ? 'Pole 9999' : 'field_9999'
      const changed = new Promise<void>((resolve, reject) => {
        const observer = new MutationObserver(() => {
          if (last.labels?.item(0)?.textContent?.trim() === label) {
            clearTimeout(timer)
            observer.disconnect()
            resolve()
          }
        })
        const timer = setTimeout(() => {
          observer.disconnect()
          reject(new Error('Large catalog did not render'))
        }, 20_000)
        observer.observe(document.body, { subtree: true, childList: true, characterData: true })
      })
      const started = performance.now()
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === 'Change language')!
        .click()
      await changed
      if (index) timings.push(performance.now() - started)
      if (first.value !== 'ready' || last.value !== 'ready')
        throw new Error('Language switch mutated values')
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    }
    return {
      timings,
      coreResponses: window.benchmark.samples.length - commands,
      stateEmissions: window.fixture.emissions - emissions,
      valueCount: Object.keys(window.fixture.snapshot!.values).length,
    }
  })
  expect(measured).toMatchObject({ coreResponses: 0, stateEmissions: 0, valueCount: 10000 })
  const json = report('language', browser.version(), design, {
    count: 10000,
    mountedControls: 10000,
    catalogKeys: 10000,
    samples: 5,
    warmups: 1,
    languageDOMReadyMs: summary(measured.timings),
    coreResponses: measured.coreResponses,
    stateEmissions: measured.stateEmissions,
    fixture:
      'inline English fallback/Slovak catalog switch; committed label DOM; no remote catalog fetch',
  })
  await info.attach('language.json', { body: json, contentType: 'application/json' })
})

test('Stress / PERF-10: no full-state observer; isolated edits and debounced snapshots at four sizes @stress', async ({
  page,
  open,
  browser,
  design,
}, info) => {
  await observeWorkers(page)
  const results: {
    count: number
    mountedControls: number
    autosave: boolean
    domReadyMs: ReturnType<typeof summary>
    unrelatedRenders: number
  }[] = []
  for (const autosave of [false, true])
    for (const count of [10, 100, 1000, 10000])
      for (const mounted of [...new Set([Math.min(count, 100), count])]) {
        await test.step(`${count} fields / ${mounted} mounted / autosave ${autosave ? 'on' : 'off'}`, async () => {
          await open('benchmark', {
            count: String(count),
            mounted: String(mounted),
            observe: 'none',
            ...(autosave ? { autosave: 'true' } : {}),
          })
          const measured = await page.evaluate(async () => {
            const input = document.querySelector<HTMLInputElement>('input[name="field_0"]')!,
              dependent = document.querySelector<HTMLInputElement>('input[name="field_1"]')!
            const samples = []
            for (let index = 0; index < 25; index++) {
              const value = index % 2 ? 'odd' : 'even',
                before = { ...window.fixture.renders },
                start = performance.now()
              await new Promise<void>((resolve, reject) => {
                const observer = new MutationObserver(check)
                const timeout = setTimeout(() => {
                  observer.disconnect()
                  reject(new Error('Unobserved edit did not commit'))
                }, 5000)
                function check() {
                  if (input.value === value && dependent.value === value) {
                    observer.disconnect()
                    clearTimeout(timeout)
                    resolve()
                  }
                }
                observer.observe(document.body, {
                  subtree: true,
                  attributes: true,
                  childList: true,
                })
                window.fixture
                  .controller!.patch({ kind: 'set_value', key: 'field_0', value })
                  .then(check, reject)
              })
              if (index >= 5)
                samples.push({
                  ms: performance.now() - start,
                  unrelated: Object.entries(window.fixture.renders)
                    .filter(([key]) => key !== 'field_0' && key !== 'field_1')
                    .reduce((sum, [key, value]) => sum + value - (before[key] ?? 0), 0),
                })
            }
            return {
              samples,
              emitted: window.fixture.emissions,
              values: [input.value, dependent.value],
              deltas: window.benchmark.samples.filter((sample) => sample.kind === 'delta'),
            }
          })
          expect(measured.emitted).toBe(0)
          expect(measured.values).toEqual(['even', 'even'])
          expect(measured.samples.every((sample) => sample.unrelated === 0)).toBe(true)
          expect(measured.deltas).toHaveLength(25)
          expect(measured.deltas.every((delta) => delta.fields === 2 && !delta.fullState)).toBe(
            true,
          )
          if (autosave) {
            await expect.poll(() => page.evaluate(() => window.fixture.saves.length)).toBe(1)
            const values = await page.evaluate(() => window.fixture.saves[0].values)
            expect(Object.keys(values)).toHaveLength(count)
            expect(values).toMatchObject({ field_0: 'even', field_1: 'even' })
          }
          results.push({
            count,
            mountedControls: mounted,
            autosave,
            domReadyMs: summary(measured.samples.map((sample) => sample.ms)),
            unrelatedRenders: 0,
          })
        })
      }
  const json = report('unobserved-edits', browser.version(), design, {
    sampleCount: 20,
    warmups: 5,
    fixture:
      'controller patch through committed DOM attributes; no onStateChange; optional host autosave; no explicit paint wait; no full snapshot consumed per edit; 100 or all controls mounted',
    results,
  })
  await info.attach('unobserved-edits.json', { body: json, contentType: 'application/json' })
})
