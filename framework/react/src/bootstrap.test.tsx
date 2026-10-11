import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import bootstrap, { installBootstrapDesign } from '../../../design/bootstrap/src/index.js'
import tungsten from '../../../design/tungsten/src/index.js'
import { TungstenThemeProvider } from './theme.js'
import type { FieldRendererProps, TungstenDesign } from './types.js'

afterEach(() => vi.unstubAllGlobals())

describe('Bootstrap design', () => {
  it('implements the full field, group and repeater contract with distinct presentation renderers', () => {
    expect(bootstrap.name).toBe('bootstrap')
    expect(Object.keys(bootstrap.fields)).toEqual(Object.keys(tungsten.fields))
    for (const type of Object.keys(tungsten.fields)) {
      expect(bootstrap.fields[type]).not.toBe(tungsten.fields[type])
    }
    expect(Object.keys(bootstrap.groups!)).toEqual(Object.keys(tungsten.groups!))
    for (const [name, definition] of Object.entries(tungsten.groups!)) {
      expect(bootstrap.groups![name].variant).toBe(definition.variant)
      expect(bootstrap.groups![name].Renderer).not.toBe(definition.Renderer)
    }
    expect(Object.keys(bootstrap.repeaters!)).toEqual(Object.keys(tungsten.repeaters!))
    for (const name of Object.keys(tungsten.repeaters!)) {
      expect(bootstrap.repeaters![name]).not.toBe(tungsten.repeaters![name])
    }
  })

  it.each(['light', 'dark'] as const)(
    'themes form and feedback roots in %s without changing the document theme',
    (colorScheme) => {
      const documentTheme = document.documentElement.getAttribute('data-bs-theme')
      render(
        <TungstenThemeProvider colorScheme={colorScheme}>
          <bootstrap.Form onSubmit={vi.fn()} submitting={false} error={null}>
            Content
          </bootstrap.Form>
          <bootstrap.Loading />
          <bootstrap.Failure />
        </TungstenThemeProvider>,
      )
      const roots = [
        screen.getByRole('button', { name: 'Submit' }).closest('form')!,
        screen.getByRole('status'),
        screen.getByRole('alert'),
      ]
      for (const root of roots) {
        expect(root).toHaveClass('tb-root')
        expect(root).toHaveAttribute('data-bs-theme', colorScheme)
        expect(root).toHaveAttribute('data-tg-color-scheme', colorScheme)
      }
      expect(screen.getByRole('button', { name: 'Submit' })).toHaveClass('btn', 'btn-primary')
      expect(document.documentElement.getAttribute('data-bs-theme')).toBe(documentTheme)
    },
  )

  it('applies Bootstrap control classes while preserving field semantics, descriptions and empty labels', () => {
    const Text = bootstrap.fields.text!
    const Number = bootstrap.fields.number!
    const Boolean = bootstrap.fields.boolean!
    function props(
      type: string,
      key: string,
      value: FieldRendererProps['state']['value'],
    ): FieldRendererProps {
      return {
        field: { type, key, view: { label: key, description: `${key} hint` } },
        inputId: key,
        state: { value, errors: [], hidden: false },
        required: true,
        disabled: false,
        readOnly: false,
        onValueChange: vi.fn(),
      }
    }
    render(
      <>
        <Text {...props('text', 'Name', 'Ada')} readOnly />
        <Number {...props('number', 'Amount', 0)} disabled />
        <Boolean {...props('boolean', 'Enabled', false)} />
        <Text
          {...props('text', 'empty', '')}
          field={{ type: 'text', key: 'empty', view: { label: '' } }}
        />
      </>,
    )
    expect(screen.getByLabelText('Name', { exact: false })).toHaveClass('form-control')
    expect(screen.getByLabelText('Name', { exact: false })).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Name', { exact: false })).toHaveAttribute(
      'aria-describedby',
      'Name-description',
    )
    expect(screen.getByLabelText('Amount', { exact: false })).toHaveValue(0)
    expect(screen.getByLabelText('Amount', { exact: false })).toBeDisabled()
    expect(screen.getByRole('checkbox')).toHaveClass('form-check-input')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(document.querySelector('label[for="empty"]')).not.toHaveTextContent('empty')
  })

  it('keeps Tungsten feedback in its own presentation inside a Bootstrap form', () => {
    render(
      <bootstrap.Form onSubmit={vi.fn()} submitting={false} error={null}>
        <tungsten.Loading />
      </bootstrap.Form>,
    )
    expect(screen.getByRole('status')).not.toHaveClass('tb-root')
    expect(screen.getByRole('status')).not.toHaveAttribute('data-bs-theme')
  })

  it('installs shared and adapter CSS once and is safe without a document', () => {
    document.getElementById('tungsten-design-bootstrap')?.remove()
    installBootstrapDesign()
    installBootstrapDesign()
    expect(document.querySelectorAll('#tungsten-design-bootstrap')).toHaveLength(1)
    expect(document.getElementById('tungsten-design-tungsten')).not.toBeNull()
    vi.stubGlobal('document', undefined)
    expect(installBootstrapDesign).not.toThrow()
  })
})

// Keep the public adapter assignable to the same contract as the default design.
const design: TungstenDesign = bootstrap
void design
