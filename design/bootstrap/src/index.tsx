import type { ComponentType } from 'react'
import type { TungstenDesign } from '../../../framework/react/src/types.js'
import tungsten from '../../tungsten/src/index.js'
import { SharedForm, SharedLoading, SharedFailure } from '../../tungsten/src/form.js'
import {
  RendererAppearanceProvider,
  type RendererAppearance,
} from '../../tungsten/src/appearance.js'
import { installBootstrapDesign } from './install.js'

const appearance: RendererAppearance = {
  colorSchemeAttribute: 'data-bs-theme',
  classes: {
    'tg-root': 'tb-root',
    'tg-input': 'form-control',
    'tg-select': 'form-select',
    'tg-label': 'form-label',
    'tg-checkbox-label': 'form-check-label',
    'tg-checkbox': 'form-check-input',
    'tg-radio': 'form-check-input',
    'tg-switch': 'form-check-input',
    'tg-description': 'form-text',
    'tg-errors': 'invalid-feedback d-block',
    'tg-submit': 'btn btn-primary',
    'tg-button': 'btn btn-outline-secondary btn-sm',
    'tg-group-trigger': 'btn btn-outline-primary',
    'tg-picker-action': 'btn btn-outline-secondary btn-sm',
    'tg-picker-done': 'btn-primary',
    'tg-file-retry': 'btn btn-outline-danger btn-sm',
    'tg-file-browse': 'btn btn-outline-primary btn-sm',
    'tg-group--card': 'card',
    'tg-group--panel': 'card',
    'tg-repeater-instance': 'card',
    'tg-section-nav': 'nav nav-tabs',
    'tg-tab': 'nav-link',
    'tg-group-error-count': 'badge text-bg-danger',
    'tg-select-menu': 'dropdown-menu show',
    'tg-select-option': 'dropdown-item',
    'tg-select-chip': 'badge',
    'tg-spinner': 'spinner-border',
    'tg-form-error': 'alert alert-danger',
    'tg-failure': 'alert alert-danger',
  },
}

function withBootstrap<Props extends object>(Renderer: ComponentType<Props>): ComponentType<Props> {
  function BootstrapRenderer(props: Props) {
    return (
      <RendererAppearanceProvider appearance={appearance}>
        <Renderer {...props} />
      </RendererAppearanceProvider>
    )
  }
  BootstrapRenderer.displayName = `Bootstrap(${Renderer.displayName ?? Renderer.name ?? 'Renderer'})`
  return BootstrapRenderer
}

export const BootstrapForm = withBootstrap(SharedForm)
export const BootstrapLoading = withBootstrap(SharedLoading)
export const BootstrapFailure = withBootstrap(SharedFailure)

// Shared renderers preserve Tungsten's validation, async, keyboard and date contracts.
// Only presentation changes; Bootstrap's imperative JavaScript is not used.
const bootstrap: TungstenDesign = {
  ...tungsten,
  name: 'bootstrap',
  install: installBootstrapDesign,
  Form: BootstrapForm,
  Loading: BootstrapLoading,
  Failure: BootstrapFailure,
  fields: Object.fromEntries(
    Object.entries(tungsten.fields).map(([name, Renderer]) => [name, withBootstrap(Renderer)]),
  ),
  groups: Object.fromEntries(
    Object.entries(tungsten.groups!).map(([name, definition]) => [
      name,
      { ...definition, Renderer: withBootstrap(definition.Renderer) },
    ]),
  ),
  repeaters: Object.fromEntries(
    Object.entries(tungsten.repeaters!).map(([name, Renderer]) => [name, withBootstrap(Renderer)]),
  ),
}

export { installBootstrapDesign }
export default bootstrap
