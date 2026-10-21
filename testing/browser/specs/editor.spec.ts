import { test, expect } from '../fixtures.js'

test('Editor: views keep the same height as content grows and the viewport changes', async ({
  page,
  design,
  designColorScheme,
}) => {
  await page.goto(`/?scenario=fields&editor=1&design=${design}&colorScheme=${designColorScheme}`)
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  const workspace = page.locator('.te-workspace')
  async function expectEqualViews() {
    for (const name of ['Editor', 'Preview', 'JSON']) {
      await page.getByRole('tab', { name, exact: true }).click()
      const panel = page.getByRole('tabpanel', { name, exact: true })
      await expect(panel).toBeVisible()
      await expect(page.locator('.te-workspace > [inert]')).toHaveCount(2)
      await expect
        .poll(() =>
          workspace.evaluate((node) => {
            // Read all boxes in one layout; a loading preview may settle between awaits.
            const heights = [node, ...node.children].map(
              (panel) => panel.getBoundingClientRect().height,
            )
            return Math.max(...heights) - Math.min(...heights)
          }),
        )
        .toBeLessThan(1)
    }
  }
  await expectEqualViews()
  await page.getByRole('tab', { name: 'Editor', exact: true }).click()
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeEnabled()
  }
  await expectEqualViews()
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await page.getByText('Load initial values', { exact: true }).click()
  await expectEqualViews()
  await page.setViewportSize({ width: 520, height: 850 })
  await expectEqualViews()
})

test('Editor: shared selects, modal scrolling, nested key hints and move spacing', async ({
  page,
  design,
  designColorScheme,
  browserName,
  isMobile,
}) => {
  await page.goto(`/?scenario=fields&editor=1&design=${design}&colorScheme=${designColorScheme}`)
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  await expect(page.locator('.te-kicker')).toHaveCount(0)
  await expect(page.locator('.te-add-target')).toHaveText('Adding to form root')
  await page.getByRole('button', { name: 'Group', exact: true }).click()
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const moves = page.locator('.te-drop-zone > button')
  expect(await moves.count()).toBeGreaterThan(0)
  await expect(moves.first()).toHaveCSS('margin-top', '8px')
  await page
    .getByRole('complementary')
    .getByRole('button', { name: /group1.text1/ })
    .click()
  const dialog = page.getByRole('dialog')
  const supportsWheel = browserName !== 'webkit' || !isMobile
  async function scrollDialog(delta: number) {
    if (supportsWheel) await page.mouse.wheel(0, delta)
    // Playwright mobile WebKit cannot send wheel input. Still verify modal scrolling
    // and the document lock; native wheel chaining is exercised in the other projects.
    else await dialog.evaluate((node, amount) => node.scrollBy(0, amount), delta)
  }
  await expect(
    dialog.getByRole('textbox', { name: 'Label', exact: true }),
  ).toHaveAccessibleDescription(
    'Text or translation key. Matching keys change with the form language.',
  )
  await expect(
    dialog.getByRole('textbox', { name: 'Field key', exact: true }),
  ).toHaveAccessibleDescription('Keep the “group1.” prefix; it links this field to its parent.')
  await expect(dialog.locator('select')).toHaveCount(0)
  const fieldType = dialog.getByRole('combobox', { name: 'Field type', exact: true })
  await expect(fieldType).toHaveClass(/tg-select/)
  await fieldType.click()
  await expect(dialog.getByRole('listbox', { name: 'Field type', exact: true })).toBeVisible()
  await fieldType.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden')
  const before = await page.evaluate(() => window.scrollY)
  await dialog.evaluate((node) => {
    node.scrollTop = 0
  })
  await dialog.hover({ position: { x: 30, y: 80 } })
  await scrollDialog(300)
  await expect.poll(() => dialog.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  await dialog.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await scrollDialog(500)
  await page.mouse.move(2, 2)
  if (supportsWheel) await page.mouse.wheel(0, 500)
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  await dialog.getByRole('button', { name: 'Apply changes' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
})

test('Editor: all JSON areas offer formatting and preserve malformed drafts', async ({
  page,
  design,
  designColorScheme,
}) => {
  await page.goto(`/?scenario=fields&editor=1&design=${design}&colorScheme=${designColorScheme}`)
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  await page.getByRole('tab', { name: 'JSON', exact: true }).click()
  const panel = page.getByRole('tabpanel', { name: 'JSON', exact: true })
  const input = panel.getByRole('textbox', { name: 'Schema JSON' })
  await expect(panel).toHaveCSS('min-height', '590px')
  expect((await input.boundingBox())!.height).toBeGreaterThan(300)
  await input.fill('{"schemaVersion":"sprout","form":[]}')
  await panel.getByRole('button', { name: 'Format JSON' }).click()
  await expect(input).toHaveValue(JSON.stringify({ schemaVersion: 'sprout', form: [] }, null, 2))
  await input.fill('{unfinished')
  await panel.getByRole('button', { name: 'Format JSON' }).click()
  await expect(input).toHaveValue('{unfinished')
  await expect(panel.getByText('Enter valid JSON before formatting.')).toBeVisible()
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await page.getByText('Load initial values', { exact: true }).click()
  const values = page.getByRole('textbox', { name: 'Initial values JSON' })
  await expect(values).toHaveAttribute('rows', '10')
  await values.fill('{"plain":"Ada"}')
  await values.locator('..').getByRole('button', { name: 'Format JSON' }).click()
  await expect(values).toHaveValue('{\n  "plain": "Ada"\n}')
})

test('Editor: typing inside JSON settings retains the caret through worker updates', async ({
  page,
  design,
  designColorScheme,
}) => {
  await page.goto(`/?scenario=fields&editor=1&design=${design}&colorScheme=${designColorScheme}`)
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page
    .getByRole('complementary')
    .getByRole('button', { name: /File.*file1/ })
    .click()
  const dialog = page.getByRole('dialog')
  const settings = dialog.getByRole('textbox', { name: 'Custom field settings (JSON)' })
  const original = await settings.inputValue()
  const insertion = original.indexOf('"api": "') + '"api": "'.length
  await settings.focus()
  await settings.evaluate(
    (node, position) => (node as HTMLTextAreaElement).setSelectionRange(position, position),
    insertion,
  )
  await settings.pressSequentially('test', { delay: 40 })
  await expect(settings).toHaveValue(
    original.slice(0, insertion) + 'test' + original.slice(insertion),
  )
  await expect
    .poll(() => settings.evaluate((node) => (node as HTMLTextAreaElement).selectionStart))
    .toBe(insertion + 4)
  await settings.press('ArrowLeft')
  await settings.press('Backspace')
  await settings.pressSequentially('sting')
  await expect(settings).toHaveValue(
    original.slice(0, insertion) + 'testingt' + original.slice(insertion),
  )
  await expect
    .poll(() => settings.evaluate((node) => (node as HTMLTextAreaElement).selectionStart))
    .toBe(insertion + 7)
})

test('Editor: saves invalid file drafts and keeps common flags out of custom settings', async ({
  page,
  design,
  designColorScheme,
  consoleChecks,
}, testInfo) => {
  await page.goto(`/?scenario=fields&editor=1&design=${design}&colorScheme=${designColorScheme}`)
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  await expect(page.locator('.te-status')).not.toHaveClass(/te-status-error/)
  const openFile = () =>
    page
      .getByRole('complementary')
      .getByRole('button', { name: /File.*file1/ })
      .click()
  await openFile()
  const dialog = page.getByRole('dialog')
  const settings = dialog.getByRole('textbox', { name: 'Custom field settings (JSON)' })
  await expect(settings).toHaveValue(
    JSON.stringify({ upload: { api: 'uploads', endpoint: 'files' } }, null, 2),
  )
  consoleChecks.expectError('tg_schema_failed_to_load_form')
  await settings.fill(JSON.stringify({ upload: { api: '', endpoint: 'files' } }))
  await dialog.getByRole('button', { name: 'Apply changes' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('alert')).toContainText('upload.api: A nonempty string is required.')
  await expect(page.locator('.te-status')).toHaveClass(/te-status-error/)
  const channels = (
    await page.locator('.te-status').evaluate((node) => getComputedStyle(node).color)
  )
    .match(/\d+/g)!
    .map(Number)
  expect(channels[0]).toBeGreaterThan(channels[1])
  expect(channels[0]).toBeGreaterThan(channels[2])
  await openFile()
  await expect(settings).toHaveAttribute('rows', '10')
  await expect(dialog.getByRole('button', { name: /^Help for/ })).toHaveCount(0)
  await expect(dialog.getByText(/Set upload.api to an API name/)).toBeVisible()
  consoleChecks.expectError('tg_schema_failed_to_load_form')
  const invalid = { upload: { api: 'test', endpoint: 'files', method: 'GET' } }
  await settings.fill(JSON.stringify(invalid))
  await dialog.getByRole('button', { name: 'Apply changes' }).click()
  await expect(dialog).not.toBeVisible()
  const error = page.getByRole('alert')
  await expect(error).toContainText('upload.method: Use POST, PUT or PATCH.')
  await expect(error).not.toContainText('messageKey')
  await page.screenshot({
    path: testInfo.outputPath('file-configuration-error.png'),
    fullPage: true,
  })
  consoleChecks.expectError('tg_schema_failed_to_load_form')
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await expect(page.locator('.te-status')).toHaveText('Draft needs attention')
  await expect(page.getByRole('alert')).toContainText('upload.method: Use POST, PUT or PATCH.')
  consoleChecks.expectError('tg_schema_failed_to_load_form')
  await page.getByRole('button', { name: 'Undo schema change' }).click()
  await expect(page.locator('.te-status')).toHaveText('Draft needs attention')
  consoleChecks.expectError('tg_schema_failed_to_load_form')
  await page.getByRole('button', { name: 'Redo schema change' }).click()
  await expect(page.locator('.te-status')).toHaveText('Draft needs attention')
  await expect(page.getByRole('alert')).toContainText('upload.method: Use POST, PUT or PATCH.')
  await page
    .getByRole('complementary')
    .getByRole('button', { name: /plain.*plain/ })
    .first()
    .click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close settings' }).click()
  await openFile()
  expect(JSON.parse(await settings.inputValue())).toEqual(invalid)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  const configured = { upload: { api: 'test', endpoint: 'files' } }
  await settings.fill(JSON.stringify({ ...configured, disabled: true, readOnly: true }))
  await dialog.getByRole('button', { name: 'Apply changes' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  await expect(error).toHaveCount(0)
  await openFile()
  expect(JSON.parse(await settings.inputValue())).toEqual(configured)
  await expect(dialog.getByRole('checkbox', { name: 'Disabled', exact: true })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Read only', exact: true })).toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Disabled', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: 'Disabled', exact: true })).not.toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Read only', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: 'Read only', exact: true })).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Apply changes' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.te-status')).toHaveText('Schema accepted')
  await openFile()
  expect(JSON.parse(await settings.inputValue())).toEqual(configured)
  await expect(dialog.getByRole('checkbox', { name: 'Disabled', exact: true })).not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Read only', exact: true })).not.toBeChecked()
})
