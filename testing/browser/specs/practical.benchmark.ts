import { test, expect } from '../fixtures.js'
import { measureEdits, observeWorkers, report, summary } from '../benchmark-tools.js'

// Representative sizes are explicit, not claimed production traffic statistics.
// Stress fixtures remain separate and continue to run in CI.
test('Practical / FORM-01: mixed forms with 10/25/50/100/250 visible fields @practical', async ({
  page,
  open,
  browser,
  design,
}, info) => {
  await observeWorkers(page)
  const results = []
  for (const count of [10, 25, 50, 100, 250]) {
    const ready = []
    // Every navigation creates a fresh worker/form. First mount warms asset caches.
    for (let mount = 0; mount < 6; mount++) {
      await open('benchmark-practical', { count: String(count) })
      const startup = await page.evaluate(() => window.fixture.readyAt - window.fixture.startedAt)
      if (mount) ready.push(startup)
    }
    const measured = await measureEdits(page)
    expect(Object.keys(measured.values)).toHaveLength(count)
    expect(measured.valid).toBe(true)
    for (const row of measured.rows)
      expect(row).toMatchObject({
        deltaFields: 2,
        fullState: false,
        unrelatedRenders: 0,
        committedInput: true,
      })
    const operations = await page.evaluate(async (count) => {
      const fixture = window.fixture,
        controller = fixture.controller!
      const validation = [],
        reset = [],
        submission = []
      for (let sample = 0; sample < 6; sample++) {
        let started = performance.now()
        const validated = await controller.validate()
        if (!validated.valid || Object.keys(validated.values ?? {}).length !== count)
          throw new Error('Incomplete validation')
        if (sample) validation.push(performance.now() - started)
        await controller.patch({ kind: 'set_value', key: 'field_0', value: 'odd' })
        await fixture.waitFor(() => fixture.snapshot?.values.field_1 === 'odd')
        started = performance.now()
        await controller.reset()
        await fixture.waitFor(() => fixture.snapshot?.values.field_0 === 'ready')
        if (fixture.snapshot!.values.field_1 !== 'ready') throw new Error('Incorrect reset')
        if (sample) reset.push(performance.now() - started)
        const before = fixture.submissions.length
        started = performance.now()
        document.querySelector('form')!.requestSubmit()
        await fixture.waitFor(() => fixture.submissions.length === before + 1)
        if (Object.keys(fixture.submissions.at(-1)!).length !== count)
          throw new Error('Incomplete submission')
        if (sample) submission.push(performance.now() - started)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
      }
      return { validation, reset, submission }
    }, count)
    // Coarse hang guard, not a hardware-independent response-time guarantee.
    expect(summary(measured.rows.map((r) => r.stateMs)).p95).toBeLessThan(1000)
    results.push({
      count,
      mountedControls: count,
      readyMs: summary(ready),
      editMs: summary(measured.rows.map((r) => r.stateMs)),
      validationMs: summary(operations.validation),
      resetMs: summary(operations.reset),
      submitMs: summary(operations.submission),
      unrelatedRenders: 0,
    })
  }
  const json = report('practical-forms', browser.version(), design, {
    category: 'practical',
    fixture:
      'All controls mounted; text/email/password/tel/textarea, numbers, booleans, selects and date/time/datetime; required/bounds and one two-field rule; complete onStateChange callback; local HTTP submission without files.',
    startup:
      'Five fresh worker/form mounts after one warmup; fixture startup to first committed state callback; excludes page/asset download.',
    editSamples: 20,
    editWarmups: 5,
    operationSamples: 5,
    operationWarmups: 1,
    percentile: 'nearest-rank',
    results,
  })
  await info.attach('practical-forms.json', { body: json, contentType: 'application/json' })
})

test('Practical / FORM-02: line items and small nested repeaters through UI actions @practical', async ({
  page,
  open,
  browser,
  design,
  driver,
}, info) => {
  const results = []
  for (const [scenario, count, collection, rows] of [
    ['benchmark-line-items', 40, 'Items', 10],
    ['benchmark-line-items', 100, 'Items', 25],
    ['benchmark-repeater', 50, 'People', 5],
    ['benchmark-repeater', 100, 'People', 10],
  ] as const) {
    await open(scenario, { count: String(count) })
    const key = collection === 'Items' ? 'items' : 'people'
    const reordered = [],
      added = [],
      removed = []
    const retained = await page.locator(`input[name="${key}[0].name"]`).elementHandle()
    for (let sample = 0; sample < 6; sample++) {
      const firstName = await page.evaluate(
        (key) => (window.fixture.snapshot!.values[key] as { name: string }[])[0].name,
        key,
      )
      // Dispatch the design's actual control without Playwright's scrolling/poll
      // latency. The normal host busy/focus behavior is included.
      const start = await driver
        .repeaterAction(collection, 'moveFirstLater')
        .evaluate((button: HTMLButtonElement) => {
          const started = performance.now()
          button.click()
          return started
        })
      await page.evaluate(
        async ({ key, firstName }) => {
          await window.fixture.waitFor(
            () =>
              (window.fixture.snapshot!.values[key] as { name: string }[])[1].name === firstName,
          )
        },
        { key, firstName },
      )
      const end = await page.evaluate(() => window.fixture.snapshotAt)
      if (sample) reordered.push(end - start)
      await expect(driver.repeaterAction(collection, 'add')).toBeEnabled()
      const target = collection === 'Items' ? 'Items' : 'Children'
      const startAdd = await driver
        .repeaterAction(target, 'add')
        .evaluate((button: HTMLButtonElement) => {
          const started = performance.now()
          button.click()
          return started
        })
      await page.evaluate(
        async ({ key, rows }) => {
          await window.fixture.waitFor(() => {
            const values = window.fixture.snapshot!.values[key] as { children?: unknown[] }[]
            return key === 'items' ? values.length === rows + 1 : values[0].children?.length === 3
          })
        },
        { key, rows },
      )
      const endAdd = await page.evaluate(() => window.fixture.snapshotAt)
      if (sample) added.push(endAdd - startAdd)
      await expect(driver.repeaterAction(target, 'removeLast')).toBeEnabled()
      const startRemove = await driver
        .repeaterAction(target, 'removeLast')
        .evaluate((button: HTMLButtonElement) => {
          const started = performance.now()
          button.click()
          return started
        })
      await page.evaluate(
        async ({ key, rows }) => {
          await window.fixture.waitFor(() => {
            const values = window.fixture.snapshot!.values[key] as { children?: unknown[] }[]
            return key === 'items' ? values.length === rows : values[0].children?.length === 2
          })
        },
        { key, rows },
      )
      const endRemove = await page.evaluate(() => window.fixture.snapshotAt)
      if (sample) removed.push(endRemove - startRemove)
      await expect(driver.repeaterAction(collection, 'add')).toBeEnabled()
    }
    // Six swaps return the original row to its original position.
    expect(
      await page
        .locator(`input[name="${key}[0].name"]`)
        .evaluate((node, original) => node === original, retained),
    ).toBe(true)
    const saved = await page.evaluate(async () => window.fixture.controller!.validate())
    expect(saved.valid).toBe(true)
    const entries = saved.values![key] as { name: string; children?: { name: string }[] }[]
    expect(entries).toHaveLength(rows)
    expect(entries[0].name).toBe(key === 'items' ? 'item-0' : 'person-0')
    if (key === 'people') expect(entries[0].children?.[0].name).toBe('child-0-0')
    expect(
      await page.evaluate(() => Object.keys(window.fixture.snapshot!.state.fields).length),
    ).toBe(count)
    for (const timings of [reordered, added, removed])
      expect(summary(timings).p95).toBeLessThan(1000)
    results.push({
      kind: key === 'items' ? 'line-items' : 'nested',
      parentRows: rows,
      childRowsPerParent: key === 'items' ? 0 : 2,
      count,
      mountedControls: count,
      reorderMs: summary(reordered),
      addMs: summary(added),
      removeMs: summary(removed),
      retainedDOM: true,
      retainedValues: true,
    })
  }
  const json = report('practical-repeaters', browser.version(), design, {
    category: 'practical',
    samples: 5,
    warmups: 1,
    fixture:
      'Actual design controls, host locks/focus and complete state callback; adjacent parent reorder; append/remove one line item or one nested child; 4 fields/line item, 10 fields/parent including children.',
    timing:
      'Actual control click through committed state callback; excludes browser-driver round trips and paint; includes host locking/focus behavior.',
    results,
  })
  await info.attach('practical-repeaters.json', { body: json, contentType: 'application/json' })
})

test('Practical / FORM-03: fresh 250-option lookup and debounced draft @practical', async ({
  page,
  request,
  session,
  open,
  browser,
  design,
}, info) => {
  await request.post(`/control/${session}`, { data: { optionCount: 250 } })
  const ready = [],
    opened = []
  for (let sample = 0; sample < 6; sample++) {
    await open('benchmark-options')
    await expect
      .poll(() =>
        page.evaluate(() => window.fixture.snapshot?.state.fields.choices.options?.length),
      )
      .toBe(250)
    const measured = await page.evaluate(async () => {
      const sourceReadyMs = window.fixture.snapshotAt - window.fixture.startedAt
      const started = performance.now()
      const ready = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (document.querySelector('[role="listbox"] [role="option"]')) {
            observer.disconnect()
            resolve()
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
      })
      ;(document.querySelector('[role="combobox"]') as HTMLElement).click()
      await ready
      return { sourceReadyMs, menuMs: performance.now() - started }
    })
    if (sample) {
      ready.push(measured.sourceReadyMs)
      opened.push(measured.menuMs)
    }
    await page.getByRole('combobox').press('End')
    await page.getByRole('combobox').press('Enter')
    await expect
      .poll(() => page.evaluate(() => window.fixture.snapshot?.values.choices))
      .toBe('option-249')
  }
  const control = await request.get(`/control/${session}`)
  expect(
    (await control.json()).requests.filter((r: { endpoint: string }) => r.endpoint === 'options'),
  ).toHaveLength(6)
  await open('benchmark-practical', { count: '50', autosave: 'true' })
  const draft = await page.evaluate(async () => {
    const started = performance.now()
    for (const value of ['o', 'od', 'odd'])
      await window.fixture.controller!.patch({ kind: 'set_value', key: 'field_0', value })
    await window.fixture.waitFor(() => window.fixture.saves.length === 1)
    return {
      editToSaveMs: window.fixture.saves[0].at - started,
      count: Object.keys(window.fixture.saves[0].values).length,
      values: window.fixture.saves[0].values,
    }
  })
  expect(draft.count).toBe(50)
  expect(draft.values).toMatchObject({ field_0: 'odd', field_1: 'odd' })
  expect(draft.editToSaveMs).toBeGreaterThanOrEqual(190)
  const json = report('practical-async', browser.version(), design, {
    category: 'practical',
    optionCount: 250,
    samples: 5,
    warmups: 1,
    sourceReadyMs: summary(ready),
    menuMs: summary(opened),
    freshRequests: 6,
    draft: { count: 50, debounceMs: 200, editToHostCallbackMs: draft.editToSaveMs, saveCount: 1 },
    fixture:
      'Real local HTTP JSON with response validation and fresh requests; source readiness includes worker/form startup; draft callback captures complete mixed values after three rapid edits. Production latency and file transfer are excluded.',
  })
  await info.attach('practical-async.json', { body: json, contentType: 'application/json' })
})
