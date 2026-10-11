import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import material, {
  createMaterialDesign,
  MaterialForm,
  MaterialLoading,
  MaterialFailure,
  installMaterialDesign,
} from '../../../design/material/src/index.js'
import tungsten from '../../../design/tungsten/src/index.js'
import { TungstenThemeProvider } from './theme.js'
import type { FieldRendererProps } from './types.js'

afterEach(() => vi.unstubAllGlobals())

function props(
  type: string,
  key: string,
  value: FieldRendererProps['state']['value'],
): FieldRendererProps {
  return {
    field: { type, key, view: { label: key, description: `${key} hint` } },
    inputId: key,
    state: { value, errors: [], hidden: false },
    required: false,
    disabled: false,
    readOnly: false,
    onValueChange: vi.fn(),
  }
}

describe('Material design', () => {
  it('implements every field/group/repeater and preserves their variants', () => {
    expect(material.name).toBe('material')
    expect(MaterialForm).toBe(material.Form)
    expect(MaterialLoading).toBe(material.Loading)
    expect(MaterialFailure).toBe(material.Failure)
    expect(Object.keys(material.fields)).toEqual(Object.keys(tungsten.fields))
    expect(Object.keys(material.groups!)).toEqual(Object.keys(tungsten.groups!))
    expect(Object.keys(material.repeaters!)).toEqual(Object.keys(tungsten.repeaters!))
    for (const [name, definition] of Object.entries(tungsten.groups!)) {
      expect(material.groups![name].variant).toBe(definition.variant)
      expect(material.groups![name].Renderer).not.toBe(definition.Renderer)
    }
  })

  it.each(['light', 'dark'] as const)(
    'themes real MUI controls and feedback locally in %s',
    (colorScheme) => {
      const Text = material.fields.text
      render(
        <TungstenThemeProvider colorScheme={colorScheme}>
          <material.Form onSubmit={vi.fn()} submitting={false} error={null}>
            <Text {...props('text', 'Name', 'Ada')} />
          </material.Form>
          <material.Loading />
          <material.Failure />
        </TungstenThemeProvider>,
      )
      const field = screen.getByLabelText('Name')
      expect(field).toHaveClass('MuiOutlinedInput-input')
      expect(field).toHaveAttribute('aria-describedby', 'Name-description')
      expect(screen.getByRole('button', { name: 'Submit' })).toHaveClass('MuiButton-contained')
      for (const root of [
        field.closest('form')!,
        screen.getByRole('status'),
        screen.getByRole('alert'),
      ]) {
        expect(root).toHaveClass('tm-root')
        expect(root).toHaveAttribute('data-tg-color-scheme', colorScheme)
        expect(root.style.getPropertyValue('--tg-color-surface')).toBe(
          colorScheme === 'dark' ? '#121212' : '#fff',
        )
      }
      expect(document.documentElement).not.toHaveAttribute('data-mui-color-scheme')
    },
  )

  it('keeps number events, read-only values, disabled controls and empty labels native', () => {
    const Text = material.fields.text,
      Number = material.fields.number
    const amount = props('number', 'Amount', 0)
    render(
      <material.Form onSubmit={vi.fn()} submitting={false} error={null}>
        <Text {...props('text', 'Name', 'Ada')} readOnly />
        <Text
          {...props('text', 'Notes', 'Text')}
          field={{
            type: 'text',
            key: 'Notes',
            textarea: true,
            rows: 3,
            resizable: false,
            view: { label: 'Notes' },
          }}
        />
        <Text
          {...props('text', 'empty', '')}
          field={{ type: 'text', key: 'empty', view: { label: '' } }}
        />
        <Number {...amount} />
        <Number {...props('number', 'Disabled', 2)} disabled />
      </material.Form>,
    )
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Disabled')).toBeDisabled()
    expect(screen.getByLabelText('Notes')).toHaveStyle({ resize: 'none' })
    expect(screen.getByLabelText('Notes')).toHaveAttribute('rows', '3')
    expect(document.querySelectorAll('textarea')).toHaveLength(1)
    expect(document.querySelector('label[for="empty"]')).not.toHaveTextContent('empty')
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1.5' } })
    expect(amount.onValueChange).toHaveBeenLastCalledWith(1.5)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '' } })
    expect(amount.onValueChange).toHaveBeenLastCalledWith(null)
  })

  it('uses MUI checkbox/switch/radio while retaining read-only and keyboard contracts', () => {
    const Boolean = material.fields.boolean
    const checkbox = props('boolean', 'Checkbox', false),
      radio = props('boolean', 'Radio', true)
    render(
      <material.Form onSubmit={vi.fn()} submitting={false} error={null}>
        <Boolean {...checkbox} />
        <Boolean
          {...props('boolean', 'Switch', true)}
          field={{ type: 'boolean', key: 'Switch', variant: 'switch', view: { label: 'Switch' } }}
          readOnly
        />
        <Boolean
          {...radio}
          field={{ type: 'boolean', key: 'Radio', variant: 'radio', view: { label: 'Radio' } }}
        />
      </material.Form>,
    )
    expect(screen.getByRole('checkbox').closest('.MuiCheckbox-root')).not.toBeNull()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(checkbox.onValueChange).toHaveBeenLastCalledWith(true)
    const control = screen.getByRole('switch')
    expect(control.closest('.MuiSwitch-root')).not.toBeNull()
    fireEvent.click(control)
    expect(control).toBeChecked()
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Yes' }), { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'No' })).toHaveFocus()
    expect(radio.onValueChange).toHaveBeenLastCalledWith(false)
  })

  it('supports per-scheme theme options and keeps default feedback isolated', () => {
    const callback = vi.fn((mode) => ({
      palette: { primary: { main: mode === 'dark' ? '#aabbcc' : '#223344' } },
    }))
    const custom = createMaterialDesign(callback)
    expect(callback.mock.calls.map(([mode]) => mode)).toEqual(['light', 'dark'])
    render(
      <TungstenThemeProvider colorScheme="dark">
        <custom.Form onSubmit={vi.fn()} submitting={false} error={null}>
          <tungsten.Loading />
        </custom.Form>
      </TungstenThemeProvider>,
    )
    expect(
      screen
        .getByRole('button', { name: 'Submit' })
        .closest('form')!
        .style.getPropertyValue('--tg-color-action'),
    ).toBe('#aabbcc')
    expect(screen.getByRole('status')).not.toHaveClass('tm-root')
  })

  it('keeps themes local even when an untyped caller supplies MUI document-theme options', () => {
    const custom = createMaterialDesign({
      cssVariables: true,
      colorSchemes: { dark: true },
      defaultColorScheme: 'dark',
    } as never)
    render(
      <custom.Form onSubmit={vi.fn()} submitting={false} error={null}>
        Content
      </custom.Form>,
    )
    expect(
      screen
        .getByRole('button', { name: 'Submit' })
        .closest('form')!
        .style.getPropertyValue('--tg-color-surface'),
    ).toBe('#fff')
    expect(
      document.querySelector('style[data-emotion="css-global"]')?.textContent ?? '',
    ).not.toContain('--mui-palette')
  })

  it('installs widget CSS once and tolerates server imports without a document', () => {
    document.getElementById('tungsten-design-material')?.remove()
    installMaterialDesign()
    installMaterialDesign()
    expect(document.querySelectorAll('#tungsten-design-material')).toHaveLength(1)
    vi.stubGlobal('document', undefined)
    expect(installMaterialDesign).not.toThrow()
  })
})
