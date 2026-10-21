import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { TungstenEditor } from './TungstenEditor.js'
import type { TungstenSchema } from '../types.js'

// jsdom has no native dialog top layer; browser checks verify actual focus trapping/Escape.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})
// Run all editor forms through real WASM; replace only the worker transport.
vi.mock('../../../../api/src/engine/client.js', async () => {
  const { readFileSync } = await import('node:fs')
  const { EngineRuntime, initSync } = await import('../../../../api/src/wasm/tungsten_core.js')
  initSync({ module: readFileSync('api/src/wasm/tungsten_core_bg.wasm') })
  return {
    EngineClient: class {
      runtime = new EngineRuntime()
      async catalog() {
        return { kind: 'catalog', catalog: JSON.parse(this.runtime.get_catalog()) }
      }
      async load(schema: unknown, values: unknown, options?: { preserveState: boolean }) {
        return {
          kind: 'loaded',
          ...JSON.parse(
            this.runtime.load_form_with_values(
              JSON.stringify(schema),
              JSON.stringify(values),
              options?.preserveState ?? false,
            ),
          ),
        }
      }
      async patch(patch: unknown) {
        return { kind: 'patched', ...JSON.parse(this.runtime.process_patch(JSON.stringify(patch))) }
      }
      async validate() {
        return { kind: 'validated', ...JSON.parse(this.runtime.validate_form()) }
      }
      async structure(operation: {
        kind: 'add' | 'remove' | 'reorder'
        key: string
        index?: number
        from?: number
        to?: number
      }) {
        const json =
          operation.kind === 'add'
            ? this.runtime.add_instance(operation.key)
            : operation.kind === 'remove'
              ? this.runtime.remove_instance(operation.key, operation.index!)
              : this.runtime.reorder_instance(operation.key, operation.from!, operation.to!)
        return { kind: 'structure', ...JSON.parse(json) }
      }
      destroy() {
        this.runtime.free()
      }
    },
  }
})
const schema: TungstenSchema = {
  schemaVersion: 'sprout',
  form: [
    { type: 'text', key: 'name', view: { label: 'Name' }, validators: [{ kind: 'required' }] },
  ],
}

describe('TungstenEditor', () => {
  it('keeps draft validation errors out of unrelated component settings', async () => {
    const onChange = vi.fn()
    render(
      <TungstenEditor
        initialSchema={{
          ...schema,
          form: [
            ...schema.form,
            {
              type: 'file',
              key: 'file1',
              view: { label: 'File' },
              upload: { api: '', endpoint: '' },
            },
          ],
        }}
        onChange={onChange}
      />,
    )
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Draft needs attention'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Number', exact: true }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Draft needs attention'),
    )
    fireEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: /Name.*name/ }),
    )
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.change(await dialog.findByRole('textbox', { name: 'Label', exact: true }), {
      target: { value: 'Full name' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'upload.api: A nonempty string is required.',
    )
    expect(screen.getByRole('status')).toHaveClass('te-status-error')
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'File', exact: true })).toBeEnabled(),
    )
    fireEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: /File.*file1/ }),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByText(/Set upload.api to an API name/)).toBeVisible()
  })

  it('shows the parent key prefix beside nested field keys in groups and repeaters', async () => {
    render(
      <TungstenEditor
        initialSchema={{
          schemaVersion: 'sprout',
          form: [
            {
              type: 'group',
              key: 'contact',
              variant: 'basic',
              render: { type: 'group', settings: {} },
              subform: [{ type: 'text', key: 'contact.name', view: { label: 'Name' } }],
            },
            {
              type: 'repeater',
              key: 'people',
              render: { type: 'undereachother', settings: {} },
              template: [{ type: 'text', key: 'people.name', view: { label: 'Person' } }],
            },
          ],
        }}
      />,
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    for (const prefix of ['contact', 'people']) {
      fireEvent.click(
        within(screen.getByRole('complementary')).getByRole('button', {
          name: new RegExp(`${prefix}\\.name`),
        }),
      )
      const dialog = within(await screen.findByRole('dialog'))
      expect(await dialog.findByRole('textbox', { name: 'Field key' })).toHaveAccessibleDescription(
        `Keep the “${prefix}.” prefix; it links this field to its parent.`,
      )
      fireEvent.click(dialog.getByRole('button', { name: 'Close settings' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
  })

  it('adds a file without opening settings, then closes accepted settings and supports undo', async () => {
    const onChange = vi.fn()
    render(<TungstenEditor initialSchema={schema} onChange={onChange} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    fireEvent.click(screen.getByRole('button', { name: 'File', exact: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce())
    const openFile = () =>
      fireEvent.click(
        within(screen.getByRole('complementary')).getByRole('button', {
          name: /File.*file1/,
        }),
      )
    openFile()
    const dialog = within(await screen.findByRole('dialog'))
    const settings = await dialog.findByRole('textbox', { name: 'Custom field settings (JSON)' })
    expect((settings as HTMLTextAreaElement).value).toContain('\n')
    expect(JSON.parse((settings as HTMLTextAreaElement).value).upload).toEqual({
      api: 'uploads',
      endpoint: 'files',
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Close settings' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    openFile()
    const reopened = within(await screen.findByRole('dialog'))
    fireEvent.change(
      await reopened.findByRole('textbox', { name: 'Custom field settings (JSON)' }),
      {
        target: { value: JSON.stringify({ upload: { api: 'main', endpoint: 'attachments' } }) },
      },
    )
    fireEvent.click(reopened.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          form: [
            schema.form[0],
            expect.objectContaining({
              type: 'file',
              key: 'file1',
              upload: expect.objectContaining({ api: 'main', endpoint: 'attachments' }),
            }),
          ],
        }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo schema change' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(3))
    fireEvent.click(screen.getByRole('button', { name: 'Undo schema change' }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(schema))
  })

  it('saves invalid component settings as a draft, closes the modal and translates the core cause', async () => {
    render(
      <TungstenEditor
        initialSchema={schema}
        config={{
          i18n: {
            translations: {
              en: {
                tg_schema_failed_to_load_form: 'Could not load form.\n{error}',
              },
            },
          },
        }}
      />,
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    fireEvent.click(screen.getByRole('button', { name: 'File', exact: true }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    fireEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', {
        name: /File.*file1/,
      }),
    )
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(await dialog.findByRole('textbox', { name: 'Custom field settings (JSON)' }), {
      target: {
        value: JSON.stringify({ upload: { api: 'main', endpoint: 'files', method: 'GET' } }),
      },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent(
      "invalid file field 'file1': upload.method: Use POST, PUT or PATCH.",
    )
    expect(error.textContent).toContain('Could not load form.\n')
    expect(error.textContent).not.toMatch(/messageKey|tg_schema_|\{"/)
    fireEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: /File.*file1/ }),
    )
    const saved = await within(await screen.findByRole('dialog')).findByRole('textbox', {
      name: 'Custom field settings (JSON)',
    })
    expect(JSON.parse((saved as HTMLTextAreaElement).value).upload.method).toBe('GET')
  })

  it('inherits dark mode through settings and preview while retaining an unfinished JSON draft', async () => {
    const onChange = vi.fn()
    const view = render(
      <TungstenEditor
        initialSchema={schema}
        colorScheme="dark"
        colorProfile="ocean"
        onChange={onChange}
      />,
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    fireEvent.click(screen.getByRole('tab', { name: 'Preview', exact: true }))
    const field = await screen.findByRole('textbox', { name: 'Name', exact: true })
    expect(field.closest('form')).toHaveAttribute('data-tg-color-scheme', 'dark')
    expect(field.closest('form')).toHaveAttribute('data-tg-color-profile', 'ocean')
    fireEvent.change(field, { target: { value: 'Ada' } })
    await waitFor(() => expect(field).toHaveValue('Ada'))
    fireEvent.click(screen.getByRole('tab', { name: 'JSON', exact: true }))
    const json = screen.getByLabelText('Schema JSON')
    fireEvent.change(json, { target: { value: '{unfinished' } })
    json.focus()
    const count = onChange.mock.calls.length
    view.rerender(<TungstenEditor initialSchema={schema} colorScheme="light" onChange={onChange} />)
    expect(json).toHaveValue('{unfinished')
    expect(json).toHaveFocus()
    expect(json.closest('.te-root')).toHaveAttribute('data-tg-color-scheme', 'light')
    expect(json.closest('.te-root')).toHaveAttribute('data-tg-color-profile', 'sprout')
    expect(onChange).toHaveBeenCalledTimes(count)
    fireEvent.click(screen.getByRole('tab', { name: 'Preview', exact: true }))
    expect(field).toHaveValue('Ada')
    expect(field.closest('form')).toHaveAttribute('data-tg-color-scheme', 'light')
    expect(field.closest('form')).toHaveAttribute('data-tg-color-profile', 'sprout')
  })

  it('retains the accepted preview for invalid JSON rules, then supports undo and redo', async () => {
    const onChange = vi.fn()
    render(<TungstenEditor initialSchema={schema} onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Preview', exact: true }))
    expect(await screen.findByRole('textbox', { name: 'Name', exact: true })).toHaveValue('')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    const preview = within(screen.getByRole('region', { name: 'Live preview' }))
    fireEvent.change(preview.getByRole('textbox', { name: 'Name' }), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Values' }))
    await waitFor(() =>
      expect(screen.getByRole('tabpanel', { name: 'Values' })).toHaveTextContent('"name": "Ada"'),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'JSON', exact: true }))
    fireEvent.change(screen.getByLabelText('Schema JSON'), {
      target: {
        value: JSON.stringify({
          schemaVersion: 'sprout',
          form: [
            {
              type: 'text',
              key: 'bad',
              rules: [
                {
                  when: { property: 'missing', operation: 'Eq', value: 'x' },
                  then: [{ kind: 'show' }],
                },
              ],
            },
          ],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('last accepted schema')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Preview', exact: true }))
    expect(screen.getByRole('tabpanel', { name: 'Values' })).toHaveTextContent('"name": "Ada"')
    fireEvent.click(screen.getByRole('button', { name: 'Undo schema change' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(onChange).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Redo schema change' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('missing')
  })
  it('authors a rule through ordinary nested Tungsten repeaters', async () => {
    const onChange = vi.fn()
    render(<TungstenEditor initialSchema={schema} onChange={onChange} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    fireEvent.click(
      within(screen.getByRole('complementary', { name: 'Field palette and outline' })).getByRole(
        'button',
        { name: /Name.*name/ },
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Rules' }))
    const source = await screen.findByRole('textbox', { name: 'Source field' })
    fireEvent.change(source, { target: { value: 'name' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Comparison value (JSON)' }), {
      target: { value: '"Ada"' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: 'Action', exact: true }))
    fireEvent.click(screen.getByRole('option', { name: 'show', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          form: [
            expect.objectContaining({
              rules: [
                {
                  when: { property: 'name', operation: 'Eq', value: 'Ada' },
                  then: [{ kind: 'show' }],
                },
              ],
            }),
          ],
        }),
      ),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('accepts a key rename after loading data and resets incompatible preview inputs', async () => {
    const onChange = vi.fn()
    render(
      <TungstenEditor initialSchema={schema} initialValues={{ name: 'Ada' }} onChange={onChange} />,
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    fireEvent.click(
      within(screen.getByRole('complementary', { name: 'Field palette and outline' })).getByRole(
        'button',
        { name: /Name.*name/ },
      ),
    )
    const key = await screen.findByRole('textbox', { name: 'Field key' })
    fireEvent.change(key, { target: { value: 'renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ form: [expect.objectContaining({ key: 'renamed' })] }),
      ),
    )
    expect(await screen.findByText('Schema accepted · initial values reset')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

function transfer() {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }
}
function drag(source: HTMLElement, target: Element) {
  const dataTransfer = transfer()
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  fireEvent.dragEnd(source, { dataTransfer })
}
const nested: TungstenSchema = {
  schemaVersion: 'sprout',
  form: [
    {
      type: 'group',
      key: 'contact',
      variant: 'basic',
      render: { type: 'group', settings: {} },
      subform: [
        {
          type: 'repeater',
          key: 'contact.people',
          render: { type: 'undereachother', settings: {} },
          template: [],
        },
      ],
    },
  ],
}

describe('editor canvas interaction', () => {
  it('categorizes the palette, drops fields into a nested template and loads prefilled keys only on request', async () => {
    const onChange = vi.fn()
    const { container } = render(<TungstenEditor initialSchema={nested} onChange={onChange} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    const palette = within(screen.getByRole('complementary', { name: 'Field palette and outline' }))
    expect(palette.getByRole('heading', { name: 'Text inputs' })).toBeInTheDocument()
    expect(palette.getByRole('heading', { name: 'Numbers & choices' })).toBeInTheDocument()
    expect(palette.getByRole('heading', { name: 'Structure' })).toBeInTheDocument()
    drag(
      palette.getByRole('button', { name: 'Text', exact: true }),
      container.querySelector('[data-drop-parent="0.0"][data-drop-index="0"]')!,
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce())
    expect(onChange.mock.calls[0][0].form[0].subform[0].template).toMatchObject([
      { type: 'text', key: 'contact.people.text1' },
    ])
    fireEvent.click(screen.getByRole('tab', { name: 'Preview', exact: true }))
    fireEvent.click(screen.getByText('Load initial values', { selector: 'summary' }))
    expect(
      JSON.parse((screen.getByLabelText('Initial values JSON') as HTMLTextAreaElement).value),
    ).toEqual({ 'contact.people': [{ text1: null }] })
    fireEvent.click(screen.getByRole('tab', { name: 'Values', exact: true }))
    await waitFor(() =>
      expect(screen.getByRole('tabpanel', { name: 'Values' })).toHaveTextContent(
        '"contact.people": []',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load values', exact: true }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Values loaded'))
    fireEvent.click(screen.getByRole('tab', { name: 'Values', exact: true }))
    await waitFor(() =>
      expect(screen.getByRole('tabpanel', { name: 'Values' })).toHaveTextContent('"text1": null'),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('moves an existing field into a group, reorders with buttons, and supports undo', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <TungstenEditor
        initialSchema={{ schemaVersion: 'sprout', form: [schema.form[0], ...nested.form] }}
        onChange={onChange}
      />,
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    drag(
      screen.getByRole('button', { name: 'Drag name', exact: true }),
      container.querySelector('[data-drop-parent="1"][data-drop-index="1"]')!,
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce())
    expect(onChange.mock.calls[0][0].form[0].subform[1]).toMatchObject({
      key: 'contact.name',
      validators: [{ kind: 'required' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move contact.name up', exact: true }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
    expect(onChange.mock.calls[1][0].form[0].subform[0].key).toBe('contact.name')
    fireEvent.click(screen.getByRole('button', { name: 'Undo schema change' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(3))
    expect(onChange.mock.calls[2][0].form[0].subform[1].key).toBe('contact.name')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('preserves edited input JSON while the schema grows and refills keys explicitly', async () => {
    const onChange = vi.fn()
    render(<TungstenEditor initialSchema={schema} onChange={onChange} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    fireEvent.click(screen.getByRole('tab', { name: 'Preview', exact: true }))
    fireEvent.click(screen.getByText('Load initial values', { selector: 'summary' }))
    const input = screen.getByLabelText('Initial values JSON') as HTMLTextAreaElement
    expect(JSON.parse(input.value)).toEqual({ name: null })
    fireEvent.change(input, { target: { value: '{"name":"unsaved"}' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Editor', exact: true }))
    fireEvent.click(
      within(screen.getByRole('complementary', { name: 'Field palette and outline' })).getByRole(
        'button',
        { name: 'Number', exact: true },
      ),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce())
    expect(input).toHaveValue('{"name":"unsaved"}')
    fireEvent.click(screen.getByRole('tab', { name: 'Preview', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Fill keys from schema' }))
    expect(JSON.parse(input.value)).toEqual({ name: 'unsaved', number1: null })
  })
})

describe('editor view isolation', () => {
  it('keeps preview edits and JSON drafts across keyboard view changes and shows components only in Editor', async () => {
    render(<TungstenEditor initialSchema={schema} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    const editor = screen.getByRole('tab', { name: 'Editor', exact: true })
    expect(screen.getByRole('complementary', { name: 'Field palette and outline' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Live preview' })).not.toBeInTheDocument()
    fireEvent.keyDown(editor, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Preview', exact: true })).toHaveFocus()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    const input = await screen.findByRole('textbox', { name: 'Name', exact: true })
    fireEvent.change(input, { target: { value: 'Grace' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Values' }))
    await waitFor(() =>
      expect(screen.getByRole('tabpanel', { name: 'Values' })).toHaveTextContent('Grace'),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'JSON', exact: true }))
    expect(screen.queryByRole('region', { name: 'Live preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Schema JSON'), { target: { value: '{"unfinished":' } })
    fireEvent.click(editor)
    fireEvent.click(screen.getByRole('tab', { name: 'Preview', exact: true }))
    expect(screen.getByRole('textbox', { name: 'Name', exact: true })).toBe(input)
    expect(input).toHaveValue('Grace')
    fireEvent.click(screen.getByRole('tab', { name: 'JSON', exact: true }))
    expect(screen.getByLabelText('Schema JSON')).toHaveValue('{"unfinished":')
  })
  it('opens component settings as a dialog, discards unapplied edits on dismissal, and accepts changes', async () => {
    const onChange = vi.fn()
    render(<TungstenEditor initialSchema={schema} onChange={onChange} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Schema accepted'))
    const select = within(screen.getByRole('complementary')).getByRole('button', {
      name: /Name.*name/,
    })
    fireEvent.click(select)
    const dialog = await screen.findByRole('dialog', { name: 'Name' })
    expect(dialog).toHaveAttribute('open')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Label', exact: true }), {
      target: { value: 'Not applied' },
    })
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(select)
    const reopened = await screen.findByRole('dialog', { name: 'Name' })
    expect(within(reopened).getByRole('textbox', { name: 'Label', exact: true })).toHaveValue(
      'Name',
    )
    fireEvent.change(within(reopened).getByRole('textbox', { name: 'Label', exact: true }), {
      target: { value: 'Full name' },
    })
    fireEvent.click(within(reopened).getByRole('button', { name: 'Apply changes' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          form: [
            expect.objectContaining({ view: expect.objectContaining({ label: 'Full name' }) }),
          ],
        }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Preview', exact: true }))
    expect(await screen.findByRole('textbox', { name: 'Full name', exact: true })).toBeVisible()
  })
})
