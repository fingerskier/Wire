import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { Message } from '../service/types'
import type { ColumnConf, Settings } from '../settings'
import { clockTime, colorIndex, dayKey, dayLabel, shortName } from '../format'

interface Props {
  column: ColumnConf
  messages: Message[] | undefined
  typing?: string
  unread: number
  /** Why history failed to load, if it did. */
  loadError?: string
  settings: Settings
  isFirst: boolean
  isLast: boolean
  onSend(text: string): Promise<void>
  onRead(): void
  onRetry(): void
  onMove(dir: -1 | 1): void
  onClose(): void
}

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  )
}

const HIDDEN_SERVICE = new Set(['joined', 'left'])

export function Column({ column, messages, typing, unread, loadError, settings, isFirst, isLast, onSend, onRead, onRetry, onMove, onClose }: Props) {
  const logRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const visible = (messages ?? []).filter((m) => settings.showJoins || !(m.service && HIDDEN_SERVICE.has(m.text)))

  // Follow the bottom of the log unless the reader has scrolled up to look at something.
  useLayoutEffect(() => {
    const el = logRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible.length, typing])

  const onScroll = () => {
    const el = logRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  let lastDay = ''
  return (
    <section
      className={`col col--${column.width}`}
      id={`col-${column.chatId}`}
      data-chat={column.chatId}
      aria-label={column.title}
      onPointerDown={unread ? onRead : undefined}
    >
      <header className="col-head">
        <div className="col-name">
          <h2 className="col-handle">{column.handle}</h2>
          <span className="col-sub">{typing ? <span className="col-typing">{shortName(typing)} is typing</span> : column.title}</span>
        </div>
        {unread > 0 && (
          <button type="button" className="badge" onClick={onRead} aria-label={`${unread} unread, mark read`}>
            {unread}
          </button>
        )}
        <div className="col-tools">
          <button type="button" className="icon-btn" onClick={() => onMove(-1)} disabled={isFirst} aria-label={`Move ${column.handle} left`}>
            ←
          </button>
          <button type="button" className="icon-btn" onClick={() => onMove(1)} disabled={isLast} aria-label={`Move ${column.handle} right`}>
            →
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={`Close ${column.handle}`}>
            ×
          </button>
        </div>
      </header>

      <div className="log" ref={logRef} onScroll={onScroll} role="log" aria-live="polite" aria-label={`${column.title} messages`}>
        {loadError ? (
          <p className="log-note log-note--warn" role="alert">
            # couldn't load history ({loadError}){' '}
            <button type="button" className="btn btn--warn btn--sm" onClick={onRetry}>
              retry
            </button>
          </p>
        ) : messages === undefined ? (
          <p className="log-note">loading…</p>
        ) : (
          messages.length === 0 && <p className="log-note">no messages yet</p>
        )}
        {visible.map((m) => {
          const day = dayKey(m.date)
          const divider = day !== lastDay
          lastDay = day
          return (
            <Fragment key={m.id}>
              {divider && <p className="log-day">──── {dayLabel(m.date)} ────</p>}
              <Line m={m} clock={settings.clock} />
            </Fragment>
          )
        })}
        {typing && (
          <div className="line line--typing">
            <span className="line-time" />
            <span className="line-who">{shortName(typing)}</span>
            <span className="line-text">
              is typing<span className="cursor" aria-hidden="true" />
            </span>
          </div>
        )}
      </div>

      <Composer chatId={column.chatId} handle={column.handle} enterSends={settings.enterSends} onSend={onSend} onFocus={onRead} />
    </section>
  )
}

function Line({ m, clock }: { m: Message; clock: Settings['clock'] }) {
  if (m.service) {
    return (
      <div className="line line--service">
        <span className="line-time">{clockTime(m.date, clock)}</span>
        <span className="line-who">*</span>
        <span className="line-text">
          {shortName(m.senderName)} {m.text}
        </span>
      </div>
    )
  }
  return (
    <div className={`line${m.out ? ' line--me' : ''}${m.mentioned ? ' line--mention' : ''}`}>
      <time className="line-time" dateTime={new Date(m.date).toISOString()}>
        {clockTime(m.date, clock)}
      </time>
      <span className={`line-who${m.out ? '' : ` h${colorIndex(m.senderId)}`}`} title={m.senderName}>
        {shortName(m.senderName)}
      </span>
      <span className="line-text">
        {m.replyTo && (
          <span className="line-reply">
            ↳ {m.replyTo.senderName ? `${shortName(m.replyTo.senderName)}: ` : ''}
            {m.replyTo.text}
          </span>
        )}
        {m.media && <span className="line-media">[{m.media.label}]</span>}
        {m.text && <span className="line-body">{linkify(m.text)}</span>}
      </span>
    </div>
  )
}

function Composer({ chatId, handle, enterSends, onSend, onFocus }: { chatId: string; handle: string; enterSends: boolean; onSend(text: string): Promise<void>; onFocus(): void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const id = `msg-${chatId.replace(/[^a-z0-9-]/gi, '')}`

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const submit = async () => {
    const sent = text
    const value = sent.trim()
    if (!value || busy) return
    setBusy(true)
    setError('')
    try {
      await onSend(value)
      // Keep anything typed while the send was in flight.
      setText((now) => (now.startsWith(sent) ? now.slice(sent.length).trimStart() : now))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      ref.current?.focus()
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    const sendNow = e.ctrlKey || e.metaKey || (enterSends && !e.shiftKey)
    if (sendNow) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="composer">
      {error && (
        <p className="composer-error" role="alert">
          not sent: {error}
        </p>
      )}
      <div className="composer-row">
        <span className="prompt" aria-hidden="true">
          &gt;
        </span>
        <label htmlFor={id} className="sr">
          Message {handle}
        </label>
        <textarea
          id={id}
          ref={ref}
          rows={1}
          value={text}
          placeholder={`message ${handle}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          enterKeyHint="send"
        />
        <button type="button" className="send" onClick={() => void submit()} disabled={busy || !text.trim()}>
          SEND ⏎
        </button>
      </div>
    </div>
  )
}
