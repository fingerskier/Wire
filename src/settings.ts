import { useSyncExternalStore } from 'react'
import type { ChatKind } from './service/types'
import { resetColors } from './format'

export type ColumnWidth = 'narrow' | 'normal' | 'wide'

export interface ColumnConf {
  chatId: string
  title: string
  handle: string
  kind: ChatKind
  width: ColumnWidth
}

export interface Settings {
  v: 1
  mode: 'demo' | 'telegram'
  apiId: string
  apiHash: string
  columns: { demo: ColumnConf[]; telegram: ColumnConf[] }
  theme: 'light' | 'dark' | 'auto'
  accent: string
  fontSize: 13 | 14 | 15 | 16
  clock: '24h' | '12h'
  showJoins: boolean
  enterSends: boolean
  notify: 'all' | 'mentions' | 'off'
  sound: boolean
}

export const SETTINGS_KEY = 'wire:settings:v1'
/** Kept apart from settings so an export never carries the account session. */
export const SESSION_KEY = 'wire:session'

export const ACCENTS = ['#D9480F', '#1F5FAD', '#2B7A3D', '#7B3FB0'] as const

export const DEFAULTS: Settings = {
  v: 1,
  mode: 'demo',
  apiId: '',
  apiHash: '',
  columns: {
    demo: [
      { chatId: 'boys', title: 'The Boys', handle: '#boys', kind: 'group', width: 'normal' },
      { chatId: 'dave', title: 'Dave', handle: '@dave', kind: 'dm', width: 'normal' },
      { chatId: 'marcus', title: 'Marcus', handle: '@marcus', kind: 'dm', width: 'normal' },
      { chatId: 'tony', title: 'Tony', handle: '@tony', kind: 'dm', width: 'narrow' },
    ],
    telegram: [],
  },
  theme: 'auto',
  accent: ACCENTS[0],
  fontSize: 14,
  clock: '24h',
  showJoins: false,
  enterSends: true,
  notify: 'mentions',
  sound: false,
}

function readJSON(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Merge untrusted input (storage or an imported file) over the defaults, keeping only known, well-typed fields. */
export function sanitize(input: unknown): Settings {
  const s: Settings = structuredClone(DEFAULTS)
  if (!input || typeof input !== 'object') return s
  const o = input as Record<string, unknown>
  const pick = <K extends keyof Settings>(k: K, ok: (v: unknown) => boolean) => {
    if (ok(o[k])) (s as unknown as Record<string, unknown>)[k] = o[k]
  }
  const oneOf = (...vals: unknown[]) => (v: unknown) => vals.includes(v)
  const isStr = (v: unknown) => typeof v === 'string'
  pick('mode', oneOf('demo', 'telegram'))
  pick('apiId', (v) => isStr(v) && /^\d{0,12}$/.test(v as string))
  pick('apiHash', (v) => isStr(v) && /^[0-9a-f]{0,64}$/i.test(v as string))
  pick('theme', oneOf('light', 'dark', 'auto'))
  pick('accent', (v) => isStr(v) && /^#[0-9a-f]{6}$/i.test(v as string))
  pick('fontSize', oneOf(13, 14, 15, 16))
  pick('clock', oneOf('24h', '12h'))
  pick('showJoins', (v) => typeof v === 'boolean')
  pick('enterSends', (v) => typeof v === 'boolean')
  pick('notify', oneOf('all', 'mentions', 'off'))
  pick('sound', (v) => typeof v === 'boolean')
  const cols = o.columns as Record<string, unknown> | undefined
  if (cols && typeof cols === 'object') {
    for (const mode of ['demo', 'telegram'] as const) {
      const list = cols[mode]
      if (!Array.isArray(list)) continue
      const seen = new Set<string>()
      s.columns[mode] = list
        .filter((c): c is ColumnConf => isColumn(c, mode))
        .filter((c) => !seen.has(c.chatId) && !!seen.add(c.chatId))
        .map(cleanColumn)
    }
  }
  return s
}

// Telegram ids are marked numeric peer ids (-100… for channels); demo ids are short words.
const CHAT_ID = { telegram: /^-?\d{1,20}$/, demo: /^[a-z][a-z0-9-]{0,31}$/ }

function isColumn(v: unknown, mode: Settings['mode']): v is ColumnConf {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return (
    typeof c.chatId === 'string' &&
    CHAT_ID[mode].test(c.chatId) &&
    !(c.chatId in Object.prototype) &&
    typeof c.title === 'string' &&
    typeof c.handle === 'string'
  )
}

function cleanColumn(c: ColumnConf): ColumnConf {
  return {
    chatId: c.chatId,
    title: c.title.slice(0, 128),
    handle: c.handle.slice(0, 64),
    kind: (['group', 'dm', 'channel'] as const).includes(c.kind) ? c.kind : 'group',
    width: (['narrow', 'normal', 'wide'] as const).includes(c.width) ? c.width : 'normal',
  }
}

let current: Settings = sanitize(readJSON(SETTINGS_KEY))
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current))
  } catch {
    // Storage full or blocked (private mode): settings still work for this tab.
  }
}

export const settingsStore = {
  get: () => current,
  set(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) {
    const p = typeof patch === 'function' ? patch(current) : patch
    current = { ...current, ...p }
    persist()
    listeners.forEach((l) => l())
  },
  replace(next: Settings) {
    current = next
    persist()
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}

// Another tab changed settings: pick it up so both tabs agree.
window.addEventListener('storage', (e) => {
  if (e.key !== SETTINGS_KEY) return
  current = sanitize(readJSON(SETTINGS_KEY))
  listeners.forEach((l) => l())
})

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get)
}

export function setColumns(mode: Settings['mode'], cols: ColumnConf[]) {
  settingsStore.set((s) => ({ columns: { ...s.columns, [mode]: cols } }))
}

export function loadSession(): string {
  try {
    return localStorage.getItem(SESSION_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveSession(session: string) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, session)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

export function exportSettings() {
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'wire-settings.json'
  a.click()
  URL.revokeObjectURL(url)
}

export async function importSettings(file: File) {
  const text = await file.text()
  settingsStore.replace(sanitize(JSON.parse(text)))
}

export function resetAll() {
  saveSession('')
  resetColors()
  settingsStore.replace(structuredClone(DEFAULTS))
}
