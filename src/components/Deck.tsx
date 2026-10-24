import { useEffect, useRef, useState } from 'react'
import type { ChatSummary, ConnStatus } from '../service/types'
import { setColumns, type ColumnConf, type Settings } from '../settings'
import { own, type Wire } from '../useWire'
import { Column } from './Column'

const STATUS_TEXT: Record<ConnStatus, string> = {
  idle: 'not set up',
  connecting: 'connecting',
  ready: 'live',
  'needs-login': 'signed out',
  offline: 'offline',
  error: 'error',
}

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

  const add = (chat: ChatSummary) => {
    const col: ColumnConf = { chatId: chat.id, title: chat.title, handle: chat.handle, kind: chat.kind, width: 'normal' }
    setColumns(mode, [...columns, col])
    setAdding(false)
    setTimeout(() => jump(chat.id), 60)
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
            settings={settings}
            isFirst={i === 0}
            isLast={i === columns.length - 1}
            onSend={(text) => wire.send(c.chatId, text)}
            onRead={() => wire.markRead(c.chatId)}
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
          onRefresh={wire.refreshChats}
          onPick={add}
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
  onRefresh(): Promise<void>
  onPick(chat: ChatSummary): void
  onClose(): void
}

function AddColumn({ chats, existing, status, onRefresh, onPick, onClose }: AddProps) {
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
          <h2 id="add-title">/add column</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <label htmlFor="add-q" className="sr">
          Filter chats
        </label>
        <input id="add-q" ref={inputRef} className="field" placeholder="filter chats…" value={q} onChange={(e) => setQ(e.target.value)} />
        {status !== 'ready' ? (
          <p className="log-note"># connect first, then your chats show up here</p>
        ) : list.length === 0 ? (
          <p className="log-note"># nothing left to add</p>
        ) : (
          <ul className="pick-list">
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
      </div>
    </dialog>
  )
}
