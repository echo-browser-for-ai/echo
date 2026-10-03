import { useEffect } from 'react'
import { useMantineColorScheme } from '@mantine/core'
import SettingsPanel from './components/SettingsPanel'

export type ThemeMode = 'dark' | 'light'

function App() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()

  useEffect(() => {
    const api = (window as any).api
    if (!api) return

    api.settings.get().then((s: any) => {
      const t: ThemeMode = s?.theme === 'light' ? 'light' : 'dark'
      setColorScheme(t)
      document.documentElement.setAttribute('data-theme', t)
    }).catch(() => {})

    const cleanup = api.settings.onThemeChanged((theme: string) => {
      const t: ThemeMode = theme === 'light' ? 'light' : 'dark'
      setColorScheme(t)
      document.documentElement.setAttribute('data-theme', t)
    })
    return () => { cleanup?.() }
  }, [setColorScheme])

  const toggleTheme = () => {
    const newTheme: ThemeMode = colorScheme === 'dark' ? 'light' : 'dark'
    setColorScheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    ;(window as any).api?.settings?.set('theme', newTheme).catch(() => {})
  }

  return <SettingsPanel theme={colorScheme as ThemeMode} onToggleTheme={toggleTheme} />
}

export default App
