import { useRef, useState, type ReactNode } from 'react'
import {
  ACCENTS,
  SETTINGS_KEY,
  exportSettings,
  importSettings,
  loadSession,
  resetAll,
  setColumns,
  settingsStore,
  type ColumnWidth,
  type Settings,
} from '../settings'
import type { Wire } from '../useWire'
import { askToNotify, tick } from '../alerts'
import { STATUS_TEXT } from '../format'

type Option<T> = readonly [value: T, label: string]

function Seg<T extends string | number | boolean>({ label, value, options, onChange }: { label: string; value: T; options: readonly Option<T>[]; onChange(v: T): void }) {
  return (
    <span className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </span>
  )
}

function Row({ k, htmlFor, children }: { k: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="row">
      {htmlFor ? (
        <label className="row-key" htmlFor={htmlFor}>
          {k}
        </label>
      ) : (
        <span className="row-key">{k}</span>
      )}
      <span className="row-val">{children}</span>
    </div>
  )
}

function Step({ label, done, now, children }: { label: string; done: boolean; now: boolean; children: ReactNode }) {
  return (
    <li className={`row step${done ? ' step--done' : now ? ' step--now' : ''}`} aria-current={now ? 'step' : undefined}>
      <span className="row-key">
        <span aria-hidden="true">{done ? '[x]' : '[ ]'}</span> {label}
        {done && <span className="sr"> (done)</span>}
      </span>
      <span className="row-val row-inline">{children}</span>
    </li>
  )
}

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="cfg" aria-labelledby={`cfg-${name}`}>
      <h2 id={`cfg-${name}`}>[{name}]</h2>
      {children}
    </section>
  )
}

const WIDTHS: readonly Option<ColumnWidth>[] = [
  ['narrow', 'S'],
  ['normal', 'M'],
  ['wide', 'L'],
]

export function SettingsPage({ settings, wire }: { settings: Settings; wire: Wire }) {
  const set = settingsStore.set
  const cols = settings.columns[settings.mode]
  const [apiId, setApiId] = useState(settings.apiId)
  const [apiHash, setApiHash] = useState(settings.apiHash)
  const [confirmReset, setConfirmReset] = useState(false)
  const [importError, setImportError] = useState('')
  const [signOutError, setSignOutError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const me = wire.service?.mode === 'telegram' ? wire.service.me() : null
  const hasSession = !!loadSession()
  const keysValid = /^\d{3,12}$/.test(apiId.trim()) && /^[0-9a-f]{32}$/i.test(apiHash.trim())
  const keysChanged = apiId.trim() !== settings.apiId || apiHash.trim() !== settings.apiHash
  const hasKeys = !!settings.apiId && !!settings.apiHash
  const signedIn = !!me || wire.status === 'ready'
  const setupDone = hasKeys && signedIn && cols.length > 0
  const toKeys = () => {
    const field = document.getElementById(apiId.trim() ? 's-apihash' : 's-apiid')
    field?.scrollIntoView({ block: 'center' })
    field?.focus()
  }

  const moveCol = (i: number, dir: -1 | 1) => {
    const next = [...cols]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setColumns(settings.mode, next)
  }

  return (
    <div className="page">
      <header className="page-head">
        <a className="btn" href="#/">
          ← deck
        </a>
        <h1>/settings</h1>
      </header>
      <p className="comment"># saved to localStorage → {SETTINGS_KEY}</p>

      <Section name="mode">
        <Row k="client">
          <Seg
            label="Client"
            value={settings.mode}
            options={[
              ['demo', 'demo'],
              ['telegram', 'telegram'],
            ]}
            onChange={(mode) => set({ mode })}
          />
        </Row>
        <p className="comment"># demo runs on made-up chats. telegram signs in as you.</p>
      </Section>

      {settings.mode === 'telegram' && !setupDone && (
        <Section name="setup">
          <p className="comment"># three steps, once. each link takes you to the step.</p>
          <ol className="steps">
            <Step label="keys" done={hasKeys} now={!hasKeys}>
              {hasKeys ? (
                'saved in this browser'
              ) : (
                <>
                  <a className="btn btn--ink" href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">
                    get keys ↗
                  </a>
                  <button type="button" className="btn" onClick={toKeys}>
                    enter them ↓
                  </button>
                </>
              )}
            </Step>
            <Step label="sign in" done={signedIn} now={hasKeys && !signedIn}>
              {signedIn ? (
                me ? `as ${me.name}` : 'signed in'
              ) : (
                <a className={`btn${hasKeys ? ' btn--ink' : ''}`} href="#/">
                  sign in →
                </a>
              )}
            </Step>
            <Step label="a chat" done={cols.length > 0} now={signedIn && cols.length === 0}>
              <a className={`btn${signedIn ? ' btn--ink' : ''}`} href="#/add">
                + add column
              </a>
            </Step>
          </ol>
        </Section>
      )}

      <Section name="connection">
        <Row k="status">
          <span className={`status status--${wire.status}`} title={wire.detail}>
            <span className="dot" aria-hidden="true" />
            {me ? `connected as ${me.name}` : settings.mode === 'demo' ? 'demo mode' : STATUS_TEXT[wire.status]}
          </span>
        </Row>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (keysValid) set({ apiId: apiId.trim(), apiHash: apiHash.trim() })
          }}
        >
          <Row k="api_id" htmlFor="s-apiid">
            <input id="s-apiid" className="field" inputMode="numeric" autoComplete="off" placeholder="1234567" value={apiId} onChange={(e) => setApiId(e.target.value)} />
          </Row>
          <Row k="api_hash" htmlFor="s-apihash">
            <input id="s-apihash" className="field" type="password" autoComplete="off" placeholder="32 hex characters" value={apiHash} onChange={(e) => setApiHash(e.target.value)} />
          </Row>
          <Row k="">
            <button type="submit" className="btn" disabled={!keysValid || !keysChanged}>
              save keys
            </button>
          </Row>
        </form>
        <p className="comment">
          # keys from{' '}
          <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">
            my.telegram.org
          </a>{' '}
          → API development tools
        </p>
        <Row k="session">
          <span className="row-inline">
            {hasSession ? 'stored in this browser' : 'none'}
            {me && (
              <button
                type="button"
                className="btn"
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true)
                  setSignOutError('')
                  try {
                    await wire.logout()
                  } catch (err) {
                    setSignOutError(err instanceof Error ? err.message : String(err))
                  } finally {
                    setSigningOut(false)
                  }
                }}
              >
                {signingOut ? 'signing out…' : 'sign out'}
              </button>
            )}
            {hasSession && (
              <button type="button" className="btn btn--warn" onClick={wire.wipeSession}>
                wipe
              </button>
            )}
          </span>
        </Row>
        {signOutError && (
          <p className="comment comment--warn" role="alert">
            # sign out failed ({signOutError}), so the session is still active on telegram. try again, or wipe to forget it in this
            browser only.
          </p>
        )}
        <p className="comment"># wipe forgets the session here; sign out also ends it on telegram</p>
      </Section>

      <Section name="columns">
        <p className="comment"># order = deck order ({settings.mode})</p>
        {cols.length === 0 && <p className="comment"># none yet</p>}
        {cols.map((c, i) => (
          <div className="row row--col" key={c.chatId}>
            <span className="row-key">
              {i + 1} {c.handle}
            </span>
            <span className="row-val row-inline">
              <Seg label={`Width of ${c.handle}`} value={c.width} options={WIDTHS} onChange={(width) => setColumns(settings.mode, cols.map((x, k) => (k === i ? { ...x, width } : x)))} />
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => moveCol(i, -1)} aria-label={`Move ${c.handle} up`}>
                ↑
              </button>
              <button type="button" className="icon-btn" disabled={i === cols.length - 1} onClick={() => moveCol(i, 1)} aria-label={`Move ${c.handle} down`}>
                ↓
              </button>
              <button type="button" className="icon-btn" onClick={() => setColumns(settings.mode, cols.filter((_, k) => k !== i))} aria-label={`Remove ${c.handle}`}>
                ×
              </button>
            </span>
          </div>
        ))}
        <a className="btn btn--dashed" href="#/add">
          + add column
        </a>
      </Section>

      <Section name="display">
        <Row k="theme">
          <Seg
            label="Theme"
            value={settings.theme}
            options={[
              ['light', 'light'],
              ['dark', 'dark'],
              ['auto', 'auto'],
            ]}
            onChange={(theme) => set({ theme })}
          />
        </Row>
        <Row k="accent">
          <span className="swatches" role="group" aria-label="Accent color">
            {ACCENTS.map((a) => (
              <button key={a} type="button" className="swatch" style={{ background: a }} aria-pressed={settings.accent === a} aria-label={a} onClick={() => set({ accent: a })} />
            ))}
          </span>
        </Row>
        <Row k="size">
          <Seg
            label="Text size"
            value={settings.fontSize}
            options={[
              [13, '13'],
              [14, '14'],
              [15, '15'],
              [16, '16'],
            ]}
            onChange={(fontSize) => set({ fontSize })}
          />
        </Row>
        <Row k="clock">
          <Seg
            label="Clock"
            value={settings.clock}
            options={[
              ['24h', '24h'],
              ['12h', '12h'],
            ]}
            onChange={(clock) => set({ clock })}
          />
        </Row>
        <Row k="joins">
          <Seg
            label="Join and leave lines"
            value={settings.showJoins}
            options={[
              [false, 'hide'],
              [true, 'show'],
            ]}
            onChange={(showJoins) => set({ showJoins })}
          />
        </Row>
      </Section>

      <Section name="input">
        <Row k="enter">
          <Seg
            label="Enter key"
            value={settings.enterSends}
            options={[
              [true, 'send'],
              [false, 'newline'],
            ]}
            onChange={(enterSends) => set({ enterSends })}
          />
        </Row>
        <p className="comment"># ctrl+enter always sends</p>
      </Section>

      <Section name="alerts">
        <Row k="notify">
          <Seg
            label="Notifications"
            value={settings.notify}
            options={[
              ['all', 'all'],
              ['mentions', 'dms+@'],
              ['off', 'off'],
            ]}
            onChange={(notify) => {
              set({ notify })
              if (notify !== 'off') void askToNotify()
            }}
          />
        </Row>
        <Row k="sound">
          <span className="row-inline">
            <Seg
              label="Sound"
              value={settings.sound}
              options={[
                [true, 'on'],
                [false, 'off'],
              ]}
              onChange={(sound) => set({ sound })}
            />
            <button type="button" className="icon-btn" onClick={tick} aria-label="Play the sound">
              ▶
            </button>
          </span>
        </Row>
      </Section>

      <Section name="data">
        <span className="row-inline row-inline--wrap">
          <button type="button" className="btn" onClick={exportSettings}>
            export .json
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                await importSettings(file)
                setImportError('')
              } catch {
                setImportError('that file is not a wire settings export')
              }
            }}
          />
          {confirmReset ? (
            <>
              <button
                type="button"
                className="btn btn--warn"
                onClick={() => {
                  resetAll()
                  setConfirmReset(false)
                }}
              >
                yes, reset everything
              </button>
              <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
                cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--warn" onClick={() => setConfirmReset(true)}>
              reset all
            </button>
          )}
        </span>
        {importError && (
          <p className="comment comment--warn" role="alert">
            # {importError}
          </p>
        )}
        <p className="comment"># export carries your api keys but never your session, so it can't sign anyone in</p>
      </Section>

      <p className="comment"># api keys go only to telegram · nothing else leaves this browser</p>
    </div>
  )
}
