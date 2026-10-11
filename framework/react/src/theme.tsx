import { createContext, useContext, type PropsWithChildren } from 'react'

export type TungstenColorScheme = 'light' | 'dark'

const ColorSchemeContext = createContext<TungstenColorScheme>('light')

/** Presentation only: the application owns theme selection and persistence. */
export function TungstenThemeProvider({
  colorScheme,
  children,
}: PropsWithChildren<{ colorScheme?: TungstenColorScheme }>) {
  const inherited = useTungstenColorScheme()
  return (
    <ColorSchemeContext.Provider value={colorScheme ?? inherited}>
      {children}
    </ColorSchemeContext.Provider>
  )
}

export function useTungstenColorScheme(): TungstenColorScheme {
  return useContext(ColorSchemeContext)
}
