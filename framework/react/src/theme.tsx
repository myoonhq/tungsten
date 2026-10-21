import { createContext, useContext, type PropsWithChildren } from 'react'

export type TungstenColorScheme = 'light' | 'dark'
/** Sprout is built in. Other names select application-supplied CSS profiles. */
export type TungstenColorProfile = string

const ColorSchemeContext = createContext<TungstenColorScheme>('light')
const ColorProfileContext = createContext<TungstenColorProfile>('sprout')

/** Presentation only: the application owns theme selection and persistence. */
export function TungstenThemeProvider({
  colorScheme,
  colorProfile,
  children,
}: PropsWithChildren<{
  colorScheme?: TungstenColorScheme
  colorProfile?: TungstenColorProfile
}>) {
  const inheritedScheme = useTungstenColorScheme()
  const inheritedProfile = useTungstenColorProfile()
  return (
    <ColorSchemeContext.Provider value={colorScheme ?? inheritedScheme}>
      <ColorProfileContext.Provider value={colorProfile ?? inheritedProfile}>
        {children}
      </ColorProfileContext.Provider>
    </ColorSchemeContext.Provider>
  )
}

export function useTungstenColorScheme(): TungstenColorScheme {
  return useContext(ColorSchemeContext)
}

export function useTungstenColorProfile(): TungstenColorProfile {
  return useContext(ColorProfileContext)
}
