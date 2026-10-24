import { useEffect, useRef, useState } from 'react'
import type { ChatSummary, ConnStatus, NewGroup } from '../service/types'
import { STATUS_TEXT } from '../format'
import { setColumns, settingsStore, type ColumnConf, type Settings } from '../settings'
import { own, type Wire } from '../useWire'
import { Column } from './Column'

interface Props {
  settings: Settings
  wire: Wire
  adding: boolean
  setAdding(open: boolean): void
}

export function Deck({ settings, wire, adding, setAdding }: Props) {
  const mode = settings.mode
  const columns = settings.columns[mode]
  const deckRef = useRef<HTMLElement>(null)
  const [active, setActive] = useState<string | undefined>(columns[0]?.chatId)
  const ids = columns.map((c) => c.chatId).join('\n')

  // Highlight the tab of the leftmost column in view (on a phone that is the one column on screen).
  useEffect(() => {
    const root = deckRef.current
    if (!root) return
    const order = ids.split('\n')
    const inView = new Set<string>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.chat
          if (!id) continue
          if (e.isIntersecting) inView.add(id)
          else inView.delete(id)
        }
        const first = order.find((id) => inView.has(id))
        if (first) setActive(first)
      },
      { root, threshold: 0.6 },
    )
    root.querySelectorAll('.col').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [ids])

  const jump = (chatId: string) => {
    document.getElementById(`col-${chatId}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
    setActive(chatId)
  }

  const move = (i: number, dir: -1 | 1) => {
    const next = [...columns]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setColumns(mode, next)
  }

  const close = (i: number) => setColumns(mode, columns.filter((_, k) => k !== i))

  const open = (chat: ChatSummary) => {
    const col: ColumnConf = { chatId: chat.id, title: chat.title, handle: chat.handle, kind: chat.kind, width: 'normal' }
    // Against the columns as they are now: making a group can finish long after this render, with columns changed since.
    settingsStore.set((s) => {
      const cols = s.columns[mode]
      return cols.some((c) => c.chatId === chat.id) ? {} : { columns: { ...s.columns, [mode]: [...cols, col] } }
    })
    setTimeout(() => jump(chat.id), 60)
  }

  const add = (chat: ChatSummary) => {
    open(chat)
    setAdding(false)
  }

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1 className="wordmark">WIRE</h1>
          {mode === 'demo' && <span className="tag">demo</span>}
          <span className={`status status--${wire.status}`} title={wire.detail}>
            <span className="dot" aria-hidden="true" />
            {STATUS_TEXT[wire.status]}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            + column
          </button>
          <a className="icon-btn icon-btn--boxed" href="#/settings" aria-label="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" aria-hidden="true">
              <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
              <rect x="13" y="4" width="4" height="4" />
              <rect x="7" y="10" width="4" height="4" />
              <rect x="15" y="16" width="4" height="4" />
            </svg>
          </a>
        </div>
        {columns.length > 0 && (
          <nav className="tabs" aria-label="Columns">
            {columns.map((c) => {
              const n = own(wire.unread, c.chatId) ?? 0
              return (
                <button
                  key={c.chatId}
                  type="button"
                  className="tab"
                  aria-current={active === c.chatId ? 'true' : undefined}
                  aria-label={n ? `${c.handle}, ${n} unread` : c.handle}
                  onClick={() => jump(c.chatId)}
                >
                  {c.handle}
                  {n > 0 && <span className="tab-badge">{n}</span>}
                </button>
              )
            })}
          </nav>
        )}
      </header>

      {wire.detail && wire.status === 'error' && (
        <p className="banner" role="alert">
          {wire.detail} · <a href="#/settings">check settings</a>
        </p>
      )}

      <main className="deck" ref={deckRef}>
        {columns.length === 0 && (
          <div className="empty">
            <p># no columns yet</p>
            <p>add the group chat and each of the boys. every chat gets its own column.</p>
            <button type="button" className="btn btn--ink" onClick={() => setAdding(true)}>
              + add a column
            </button>
          </div>
        )}
        {columns.map((c, i) => (
          <Column
            key={c.chatId}
            column={c}
            messages={own(wire.messages, c.chatId)}
            typing={own(wire.typing, c.chatId)}
            unread={own(wire.unread, c.chatId) ?? 0}
            loadError={own(wire.loadErrors, c.chatId)}
            settings={settings}
            isFirst={i === 0}
            isLast={i === columns.length - 1}
            onSend={(text) => wire.send(c.chatId, text)}
            onRead={() => wire.markRead(c.chatId)}
            onRetry={() => wire.retryHistory(c.chatId)}
            onMove={(dir) => move(i, dir)}
            onClose={() => close(i)}
          />
        ))}
        {columns.length > 0 && (
          <button type="button" className="add-col" onClick={() => setAdding(true)}>
            + add column
          </button>
        )}
      </main>

      {adding && (
        <AddColumn
          chats={wire.chats}
          existing={new Set(columns.map((c) => c.chatId))}
          status={wire.status}
          selfId={wire.service?.me()?.id}
          onRefresh={wire.refreshChats}
          onPick={add}
          onCreate={wire.createGroup}
          onCreated={open}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}

interface AddProps {
  chats: ChatSummary[]
  existing: Set<string>
  status: ConnStatus
  selfId?: string
  onRefresh(): Promise<void>
  onPick(chat: ChatSummary): void
  onCreate(title: string, memberIds: string[]): Promise<NewGroup>
  /** Opens the new group's column but leaves the dialog up, in case there's news about who wasn't added. */
  onCreated(chat: ChatSummary): void
  onClose(): void
}

function AddColumn({ chats, existing, status, selfId, onRefresh, onPick, onCreate, onCreated, onClose }: AddProps) {
  const [view, setView] = useState<'pick' | 'new'>('pick')
  const [q, setQ] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // A native modal dialog: it traps focus, makes the deck inert and handles Escape.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    dialogRef.current?.showModal()
    inputRef.current?.focus()
    onRefresh().catch(() => {})
    return () => opener?.focus?.()
    // Once per opening, not on every render.
  }, [])

  const needle = q.trim().toLowerCase()
  const list = chats
    .filter((c) => !existing.has(c.id))
    .filter((c) => !needle || c.title.toLowerCase().includes(needle) || c.handle.includes(needle))

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="add-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dialog-body">
        <header className="dialog-head">
          <h2 id="add-title">{view === 'new' ? '/new group' : '/add column'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {view === 'new' ? (
          <NewGroupForm
            people={chats.filter((c) => c.kind === 'dm' && c.id !== selfId && !c.deleted)}
            onCreate={onCreate}
            onCreated={onCreated}
            onBack={() => {
              setView('pick')
              setTimeout(() => inputRef.current?.focus())
            }}
            onClose={onClose}
          />
        ) : (
          <>
            <label htmlFor="add-q" className="sr">
              Filter chats
            </label>
            <input id="add-q" ref={inputRef} className="field" placeholder="filter chats…" value={q} onChange={(e) => setQ(e.target.value)} />
            {status !== 'ready' ? (
              <p className="log-note"># connect first, then your chats show up here</p>
            ) : (
              <ul className="pick-list">
                <li>
                  <button type="button" className="pick pick--new" onClick={() => setView('new')}>
                    <span className="pick-handle">+ new group</span>
                    <span className="pick-title">name it, pick who's in</span>
                  </button>
                </li>
                {list.length === 0 && <li className="log-note"># nothing else to add</li>}
                {list.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="pick" onClick={() => onPick(c)}>
                      <span className="pick-handle">{c.handle}</span>
                      <span className="pick-title">
                        {c.title} · {c.kind}
                      </span>
                      {c.unread > 0 && <span className="tab-badge">{c.unread}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </dialog>
  )
}

function groupError(err: unknown) {
  const e = (err ?? {}) as { errorMessage?: string; message?: string }
  const code = e.errorMessage || e.message || String(err)
  if (code.includes('CHANNELS_TOO_MUCH')) return "you're in too many groups and channels to make another. leave one first."
  if (code.includes('FLOOD')) return 'telegram says slow down. wait a few minutes and try again.'
  if (code.includes('CHAT_TITLE_EMPTY')) return 'the group needs a name.'
  return code
}

interface NewGroupProps {
  people: ChatSummary[]
  onCreate(title: string, memberIds: string[]): Promise<NewGroup>
  onCreated(chat: ChatSummary): void
  onBack(): void
  onClose(): void
}

function NewGroupForm({ people, onCreate, onCreated, onBack, onClose }: NewGroupProps) {
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState<{ handle: string; names: string[] } | null>(null)
  /** False once the form is gone (back, close, Escape) while Telegram is still making the group. */
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])

  const needle = q.trim().toLowerCase()
  const list = people.filter((p) => !needle || p.title.toLowerCase().includes(needle) || p.handle.includes(needle))
  const toggle = (id: string) => setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  if (missing) {
    return (
      <div className="dialog-form">
        <p className="log-note"># made {missing.handle}. it's open as a column.</p>
        <p className="log-note log-note--warn" role="alert">
          # telegram wouldn't add {missing.names.join(', ')}. that's usually their privacy settings: send them an invite link from a telegram
          app.
        </p>
        <div className="actions">
          <button type="button" className="btn btn--ink" onClick={onClose} autoFocus>
            done
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="dialog-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const title = name.trim()
        if (!title || busy) return
        setBusy(true)
        setError('')
        try {
          const made = await onCreate(title, picked)
          // The group exists now, so open it even if the form was dismissed; just don't touch a dialog that's gone (or reopened).
          onCreated(made.chat)
          if (!shown.current) return
          if (made.notAdded.length) setMissing({ handle: made.chat.handle, names: made.notAdded })
          else onClose()
        } catch (err) {
          if (shown.current) setError(groupError(err))
        } finally {
          if (shown.current) setBusy(false)
        }
      }}
    >
      <button type="button" className="btn btn--sm" onClick={onBack}>
        ← chats
      </button>
      <label htmlFor="ng-name" className="sr">
        Group name
      </label>
      <input id="ng-name" className="field" placeholder="group name" maxLength={128} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <label htmlFor="ng-q" className="sr">
        Filter people
      </label>
      <input id="ng-q" className="field" placeholder="filter people…" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="log-note">
        # {picked.length ? `${picked.length} in, plus you` : 'just you so far. tick people from your dms'}
      </p>
      {people.length === 0 ? (
        <p className="log-note"># no dms to pick from yet. you can still make it and add people in telegram.</p>
      ) : (
        <ul className="pick-list">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" className="pick" aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
                <span className="pick-handle">
                  <span aria-hidden="true">{picked.includes(p.id) ? '[x]' : '[ ]'}</span> {p.handle}
                </span>
                <span className="pick-title">{p.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="log-note log-note--warn" role="alert">
          # {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn btn--ink" disabled={busy || !name.trim()}>
          {busy ? 'making…' : 'make group'}
        </button>
      </div>
    </form>
  )
}
