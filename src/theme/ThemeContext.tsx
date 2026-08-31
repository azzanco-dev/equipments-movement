import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getInitialTheme(): Theme {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark') return stored
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark'
  }
  return 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Keep the server and the first client render identical. Browser preferences
  // are applied after hydration because they are unavailable to the server.
  const [theme, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    const initialTheme = getInitialTheme()
    const root = document.documentElement
    root.classList.toggle('dark', initialTheme === 'dark')
    setThemeState(initialTheme)
  }, [])

  const setTheme = useCallback((nextTheme: Theme) => {
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    localStorage.setItem('theme', nextTheme)
    setThemeState(nextTheme)
  }, [])
  const toggleTheme = useCallback(() => {
    setThemeState((previousTheme) => {
      const nextTheme = previousTheme === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('dark', nextTheme === 'dark')
      localStorage.setItem('theme', nextTheme)
      return nextTheme
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
