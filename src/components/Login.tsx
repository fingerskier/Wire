import { useMemo, useState, type FormEvent } from 'react'
import { settingsStore, type Settings } from '../settings'
import type { Wire } from '../useWire'

type Step = 'phone' | 'code' | 'password'

function errText(err: unknown) {
  if (err && typeof err === 'object') {
    const e = err as { errorMessage?: string; message?: string }
    const code = e.errorMessage || e.message || ''
    if (code.includes('PHONE_NUMBER_INVALID')) return 'that phone number is not valid. include the country code, like +1…'
    if (code.includes('PHONE_CODE_INVALID')) return 'wrong code. try again.'
    if (code.includes('PHONE_CODE_EXPIRED')) return 'that code expired. go back and send a new one.'
    if (code.includes('PASSWORD_HASH_INVALID')) return 'wrong password.'
    if (code.includes('API_ID_INVALID')) return 'telegram rejected the api_id / api_hash pair. check them in settings.'
    if (code.includes('FLOOD')) return 'telegram says slow down. wait a few minutes and try again.'
    return code || String(err)
  }
  return String(err)
}

export function Login({ settings, wire }: { settings: Settings; wire: Wire }) {
  const hasKeys = !!settings.apiId && !!settings.apiHash
  const steps = useMemo(() => wire.service?.login(), [wire.service])
  const [step, setStep] = useState<Step>('phone')
  const [apiId, setApiId] = useState(settings.apiId)
  const [apiHash, setApiHash] = useState(settings.apiHash)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [viaApp, setViaApp] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const keysValid = /^\d{3,12}$/.test(apiId.trim()) && /^[0-9a-f]{32}$/i.test(apiHash.trim())

  return (
    <div className="page page--narrow">
      <header className="page-head">
        <h1 className="wordmark">WIRE</h1>
        <span className="comment">/login</span>
      </header>

      {!hasKeys ? (
        <form
          className="cfg"
          onSubmit={run(async () => {
            settingsStore.set({ apiId: apiId.trim(), apiHash: apiHash.trim() })
          })}
        >
          <h2>[keys]</h2>
          <p className="comment">
            # wire talks to telegram as you, so it needs your own app keys. make them once at{' '}
            <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">
              my.telegram.org
            </a>{' '}
            → API development tools.
          </p>
          <div className="row">
            <label className="row-key" htmlFor="l-apiid">
              api_id
            </label>
            <span className="row-val">
              <input id="l-apiid" className="field" inputMode="numeric" autoComplete="off" placeholder="1234567" value={apiId} onChange={(e) => setApiId(e.target.value)} />
            </span>
          </div>
          <div className="row">
            <label className="row-key" htmlFor="l-apihash">
              api_hash
            </label>
            <span className="row-val">
              <input id="l-apihash" className="field" type="password" autoComplete="off" placeholder="32 hex characters" value={apiHash} onChange={(e) => setApiHash(e.target.value)} />
            </span>
          </div>
          <div className="actions">
            <button type="submit" className="btn btn--ink" disabled={!keysValid}>
              continue
            </button>
          </div>
        </form>
      ) : !steps || wire.status === 'connecting' ? (
        <p className="comment"># connecting to telegram…</p>
      ) : step === 'phone' ? (
        <form
          className="cfg"
          onSubmit={run(async () => {
            const r = await steps.sendCode(phone)
            setViaApp(r.viaApp)
            setStep('code')
          })}
        >
          <h2>[phone]</h2>
          <div className="row">
            <label className="row-key" htmlFor="l-phone">
              number
            </label>
            <span className="row-val">
              <input id="l-phone" className="field" type="tel" autoComplete="tel" placeholder="+1 555 010 0100" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
            </span>
          </div>
          <div className="actions">
            <button type="submit" className="btn btn--ink" disabled={busy || phone.replace(/\D/g, '').length < 7}>
              {busy ? 'sending…' : 'send code'}
            </button>
          </div>
        </form>
      ) : step === 'code' ? (
        <form
          className="cfg"
          onSubmit={run(async () => {
            if ((await steps.signIn(code)) === 'password') setStep('password')
          })}
        >
          <h2>[code]</h2>
          <p className="comment"># {viaApp ? 'telegram sent the code to your other telegram app' : 'telegram sent the code by sms'}</p>
          <div className="row">
            <label className="row-key" htmlFor="l-code">
              code
            </label>
            <span className="row-val">
              <input id="l-code" className="field" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </span>
          </div>
          <div className="actions">
            <button type="submit" className="btn btn--ink" disabled={busy || code.trim().length < 4}>
              {busy ? 'checking…' : 'sign in'}
            </button>
            <button type="button" className="btn" onClick={() => setStep('phone')}>
              different number
            </button>
          </div>
        </form>
      ) : (
        <form className="cfg" onSubmit={run(() => steps.checkPassword(password))}>
          <h2>[2fa]</h2>
          <p className="comment"># this account has a cloud password</p>
          <div className="row">
            <label className="row-key" htmlFor="l-pw">
              password
            </label>
            <span className="row-val">
              <input id="l-pw" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </span>
          </div>
          <div className="actions">
            <button type="submit" className="btn btn--ink" disabled={busy || !password}>
              {busy ? 'checking…' : 'unlock'}
            </button>
          </div>
        </form>
      )}

      {(error || (wire.status === 'error' && wire.detail)) && (
        <p className="comment comment--warn" role="alert">
          # {error || errText({ message: wire.detail })}
        </p>
      )}

      <div className="actions">
        <button type="button" className="btn" onClick={() => settingsStore.set({ mode: 'demo' })}>
          try the demo instead
        </button>
        <a className="btn" href="#/settings">
          settings
        </a>
      </div>
    </div>
  )
}
