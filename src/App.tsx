import { useEffect, useState } from 'react'
import { useSettings, type Settings } from './settings'
import { useWire } from './useWire'
import { Deck } from './components/Deck'
import { Login } from './components/Login'
import { SettingsPage } from './components/SettingsPage'

function useRoute() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash.replace(/^#\/?/, '') || 'deck'
}

function useTheme(s: Settings) {
  useEffect(() => {
    const root = document.documentElement
    const dark = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      root.dataset.theme = s.theme === 'auto' ? (dark.matches ? 'dark' : 'light') : s.theme
    }
    apply()
    dark.addEventListener('change', apply)
    return () => dark.removeEventListener('change', apply)
  }, [s.theme])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', s.accent)
    root.style.setProperty('--fs', `${s.fontSize}px`)
  }, [s.accent, s.fontSize])
}

export function App() {
  const settings = useSettings()
  const route = useRoute()
  const wire = useWire(settings)
  useTheme(settings)

  if (route === 'settings') return <SettingsPage settings={settings} wire={wire} />

  const needsLogin = settings.mode === 'telegram' && (!settings.apiId || !settings.apiHash || wire.status === 'needs-login')
  if (needsLogin) return <Login settings={settings} wire={wire} />

  return (
    <Deck
      settings={settings}
      wire={wire}
      adding={route === 'add'}
      setAdding={(open) => {
        location.hash = open ? '#/add' : '#/'
      }}
    />
  )
}
