import type { ComponentType, CSSProperties } from 'react'
import {
  createTheme,
  darken,
  lighten,
  alpha,
  ThemeProvider,
  type Theme,
  type ThemeOptions,
} from '@mui/material/styles'
import type { TungstenDesign } from '../../../framework/react/src/types.js'
import {
  useTungstenColorScheme,
  type TungstenColorScheme,
} from '../../../framework/react/src/theme.js'
import tungsten from '../../tungsten/src/index.js'
import { SharedForm, SharedLoading, SharedFailure } from '../../tungsten/src/form.js'
import {
  RendererAppearanceProvider,
  type RendererAppearance,
} from '../../tungsten/src/appearance.js'
import { MaterialInput, MaterialTextarea, MaterialButton } from './components.js'
import { installMaterialDesign } from './install.js'

/** Tungsten owns mode selection and scoped tokens, rather than MUI's document-wide CSS variables. */
type ScopedThemeOptions = Omit<ThemeOptions, 'cssVariables' | 'colorSchemes' | 'defaultColorScheme'>

/** Theme options are evaluated once for each scheme; switching themes preserves form state. */
export type MaterialThemeOptions =
  | ScopedThemeOptions
  | ((colorScheme: TungstenColorScheme) => ScopedThemeOptions)

function tokens(theme: Theme): CSSProperties {
  const { palette: p } = theme
  const dark = p.mode === 'dark'
  const surface = p.background.paper
  const mix = dark ? darken : lighten
  const accentSoft = mix(p.primary.main, dark ? 0.75 : 0.92)
  const danger = dark ? p.error.light : p.error.dark
  return {
    fontFamily: theme.typography.fontFamily,
    '--tm-radius': `${theme.shape.borderRadius}px`,
    '--tg-radius-control': `${theme.shape.borderRadius}px`,
    '--tg-radius-panel': `${theme.shape.borderRadius}px`,
    '--tg-color-ink': p.text.primary,
    '--tg-color-muted': p.text.secondary,
    '--tg-color-subtle': p.text.secondary,
    '--tg-color-border': dark ? p.grey[700] : p.grey[300],
    '--tg-color-border-hover': dark ? p.grey[500] : p.grey[600],
    '--tg-color-surface': surface,
    '--tg-color-surface-raised': dark ? p.grey[900] : p.grey[50],
    '--tg-color-accent': p.primary.main,
    '--tg-color-accent-deep': dark ? p.primary.light : p.primary.dark,
    '--tg-color-accent-soft': accentSoft,
    '--tg-color-danger': danger,
    '--tg-color-danger-soft': mix(p.error.main, dark ? 0.8 : 0.95),
    '--tg-color-danger-border': p.error.main,
    '--tg-color-danger-ink': danger,
    '--tg-color-on-danger': p.error.contrastText,
    '--tg-color-disabled-border': p.divider,
    '--tg-color-disabled-surface': dark ? p.grey[800] : p.grey[100],
    '--tg-color-disabled-ink': p.text.disabled,
    '--tg-color-readonly-ink': p.text.secondary,
    '--tg-color-divider': p.divider,
    '--tg-color-action': p.primary.main,
    '--tg-color-action-hover': dark ? p.primary.light : p.primary.dark,
    '--tg-color-on-action': p.primary.contrastText,
    '--tg-color-switch-track': p.action.disabledBackground,
    '--tg-color-switch-thumb': p.primary.contrastText,
    '--tg-color-backdrop': alpha(p.common.black, dark ? 0.7 : 0.5),
    '--tg-shadow-focus': `0 0 0 3px ${alpha(p.primary.main, 0.3)}`,
    '--tg-shadow-invalid': `0 0 0 3px ${alpha(p.error.main, 0.3)}`,
    '--tg-shadow-button': theme.shadows[2],
    '--tg-shadow-form': theme.shadows[1],
    '--tg-shadow-menu': theme.shadows[8],
    '--tg-shadow-card': theme.shadows[1],
    '--tg-shadow-switch': theme.shadows[1],
  } as CSSProperties
}

/** Optional Material UI integration. No global reset or host theme changes are applied. */
export function createMaterialDesign(options: MaterialThemeOptions = {}): TungstenDesign {
  const appearances = {} as Record<TungstenColorScheme, RendererAppearance>
  const themes = {} as Record<TungstenColorScheme, Theme>
  for (const mode of ['light', 'dark'] as const) {
    const settings = typeof options === 'function' ? options(mode) : options
    const themeOptions: ThemeOptions = { ...settings, palette: { ...settings.palette, mode } }
    // Enforce the same local-theme contract for untyped JavaScript callers.
    delete themeOptions.cssVariables
    delete themeOptions.colorSchemes
    delete themeOptions.defaultColorScheme
    const theme = createTheme(themeOptions)
    themes[mode] = theme
    appearances[mode] = {
      classes: { 'tg-root': 'tm-root' },
      rootStyle: tokens(theme),
      components: { Input: MaterialInput, Textarea: MaterialTextarea, Button: MaterialButton },
    }
  }
  function withMaterial<Props extends object>(
    Renderer: ComponentType<Props>,
  ): ComponentType<Props> {
    function MaterialRenderer(props: Props) {
      const mode = useTungstenColorScheme()
      return (
        <ThemeProvider theme={themes[mode]}>
          <RendererAppearanceProvider appearance={appearances[mode]}>
            <Renderer {...props} />
          </RendererAppearanceProvider>
        </ThemeProvider>
      )
    }
    MaterialRenderer.displayName = `Material(${Renderer.displayName ?? Renderer.name ?? 'Renderer'})`
    return MaterialRenderer
  }
  return {
    ...tungsten,
    name: 'material',
    install: installMaterialDesign,
    Form: withMaterial(SharedForm),
    Loading: withMaterial(SharedLoading),
    Failure: withMaterial(SharedFailure),
    fields: Object.fromEntries(
      Object.entries(tungsten.fields).map(([name, Renderer]) => [name, withMaterial(Renderer)]),
    ),
    groups: Object.fromEntries(
      Object.entries(tungsten.groups!).map(([name, definition]) => [
        name,
        { ...definition, Renderer: withMaterial(definition.Renderer) },
      ]),
    ),
    repeaters: Object.fromEntries(
      Object.entries(tungsten.repeaters!).map(([name, Renderer]) => [name, withMaterial(Renderer)]),
    ),
  }
}

const material = createMaterialDesign()
export const MaterialForm = material.Form
export const MaterialLoading = material.Loading
export const MaterialFailure = material.Failure
export { installMaterialDesign }
export default material
