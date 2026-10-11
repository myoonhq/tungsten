import {
  createContext,
  useContext,
  type PropsWithChildren,
  type ComponentPropsWithRef,
  type ComponentType,
  type CSSProperties,
} from 'react'

/** Presentation only: adapters share the same controlled inputs and interactions. */
export type RendererAppearance = {
  classes: Readonly<Record<string, string>>
  colorSchemeAttribute?: `data-${string}`
  rootStyle?: CSSProperties
  components?: {
    Input: ComponentType<ComponentPropsWithRef<'input'>>
    Textarea: ComponentType<ComponentPropsWithRef<'textarea'>>
    Button: ComponentType<ComponentPropsWithRef<'button'>>
  }
}

const defaultAppearance: RendererAppearance = { classes: {} }
const AppearanceContext = createContext(defaultAppearance)

export function RendererAppearanceProvider({
  appearance,
  children,
}: PropsWithChildren<{ appearance: RendererAppearance }>) {
  return <AppearanceContext.Provider value={appearance}>{children}</AppearanceContext.Provider>
}

export function useRendererAppearance() {
  return useContext(AppearanceContext)
}

const identity = (names: string) => names

export function useRendererClasses() {
  const appearance = useRendererAppearance()
  const { classes } = appearance
  if (Object.keys(classes).length === 0) return identity
  return (names: string) =>
    names
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((name) => (classes[name] ? [name, classes[name]] : [name]))
      .join(' ')
}

const nativeComponents = { Input: 'input', Textarea: 'textarea', Button: 'button' } as const

export function useRendererComponents() {
  return useRendererAppearance().components ?? nativeComponents
}
