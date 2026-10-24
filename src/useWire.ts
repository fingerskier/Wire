import { useCallback, useEffect, useRef, useState } from 'react'
import { createService } from './service'
import type { ChatService, ChatSummary, ConnStatus, Message, ServiceEvent } from './service/types'
import { SESSION_KEY, saveSession, settingsStore, type Settings } from './settings'
import { showNotification, tick } from './alerts'

export interface Wire {
  service: ChatService | null
  status: ConnStatus
  detail?: string
  chats: ChatSummary[]
  messages: Record<string, Message[]>
  typing: Record<string, string>
  unread: Record<string, number>
  send(chatId: string, text: string): Promise<void>
  markRead(chatId: string): void
  refreshChats(): Promise<void>
  /** Rejects, and keeps the session, if Telegram didn't confirm the sign-out. */
  logout(): Promise<void>
  wipeSession(): void
}

const TYPING_MS = 6000

/** Chat ids come from storage and imports; never let `constructor` & co. resolve to inherited values. */
export function own<T>(rec: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined
}

function appendUnique(list: Message[], m: Message) {
  return list.some((x) => x.id === m.id) ? list : [...list, m]
}

function without<T>(rec: Record<string, T>, key: string) {
  if (!Object.hasOwn(rec, key)) return rec
  const { [key]: _, ...rest } = rec
  return rest
}

/** Owns the live connection: one service per mode + credentials, and the messages for the open columns. */
export function useWire(settings: Settings): Wire {
  const { mode, apiId, apiHash } = settings
  const configured = mode === 'demo' || (!!apiId && !!apiHash)
  const [nonce, setNonce] = useState(0)
  const [service, setService] = useState<ChatService | null>(null)
  const [status, setStatus] = useState<ConnStatus>('idle')
  const [detail, setDetail] = useState<string>()
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [typing, setTyping] = useState<Record<string, string>>({})
  const [unread, setUnread] = useState<Record<string, number>>({})
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const loaded = useRef(new Set<string>())
  /** The service whose results may still land in state. Anything else is stale. */
  const live = useRef<ChatService | null>(null)

  useEffect(() => {
    setChats([])
    setMessages({})
    setUnread({})
    setTyping({})
    setDetail(undefined)
    loaded.current = new Set()
    if (!configured) {
      setStatus('idle')
      return
    }
    setStatus('connecting')
    let cancelled = false
    let svc: ChatService | null = null
    let off = () => {}

    const clearTyping = (chatId: string) => {
      clearTimeout(typingTimers.current.get(chatId))
      typingTimers.current.delete(chatId)
      setTyping((t) => without(t, chatId))
    }

    const columnFor = (chatId: string) => {
      const s = settingsStore.get()
      return s.columns[s.mode].find((c) => c.chatId === chatId)
    }

    const onEvent = (e: ServiceEvent) => {
      if (cancelled) return
      switch (e.type) {
        case 'status':
          setStatus(e.status)
          setDetail(e.detail)
          if (e.status === 'ready' && svc) {
            const from = svc
            from
              .listChats()
              .then((cs) => {
                if (live.current !== from) return
                setChats(cs)
                setUnread((u) => {
                  const next = { ...u }
                  for (const c of cs) if (c.unread && !Object.hasOwn(next, c.id)) next[c.id] = c.unread
                  return next
                })
              })
              .catch(() => {})
          }
          return
        case 'typing':
          setTyping((t) => ({ ...t, [e.chatId]: e.name }))
          clearTimeout(typingTimers.current.get(e.chatId))
          typingTimers.current.set(
            e.chatId,
            setTimeout(() => clearTyping(e.chatId), TYPING_MS),
          )
          return
        case 'edited':
          setMessages((all) => {
            const list = own(all, e.message.chatId)
            if (!list?.some((m) => m.id === e.message.id)) return all
            return { ...all, [e.message.chatId]: list.map((m) => (m.id === e.message.id ? { ...e.message, replyTo: m.replyTo ?? e.message.replyTo } : m)) }
          })
          return
        case 'deleted': {
          const gone = new Set(e.ids)
          setMessages((all) => {
            const next: Record<string, Message[]> = {}
            let changed = false
            for (const [chatId, list] of Object.entries(all)) {
              // Without a chat, ids are account-wide and only apply to non-channel chats (marked -100…).
              const applies = e.chatId ? chatId === e.chatId : !chatId.startsWith('-100')
              const kept = applies ? list.filter((m) => !gone.has(m.id)) : list
              if (kept.length !== list.length) changed = true
              next[chatId] = kept
            }
            return changed ? next : all
          })
          return
        }
        case 'message': {
          const m = e.message
          const column = columnFor(m.chatId)
          if (!column) return
          // Buffer even before history arrives; the history merge dedupes by id.
          setMessages((all) => ({ ...all, [m.chatId]: appendUnique(own(all, m.chatId) ?? [], m) }))
          clearTyping(m.chatId)
          if (m.out) return
          // Typing in that column right now: it's already read.
          const watching = !document.hidden && !!document.getElementById(`col-${m.chatId}`)?.contains(document.activeElement)
          if (watching) void svc?.markRead(m.chatId)
          else setUnread((u) => ({ ...u, [m.chatId]: (own(u, m.chatId) ?? 0) + 1 }))
          const s = settingsStore.get()
          const wants = s.notify === 'all' || (s.notify === 'mentions' && (column.kind === 'dm' || m.mentioned))
          if (wants && document.hidden) showNotification(column.title, `${m.senderName}: ${m.text || m.media?.label || ''}`, m.chatId)
          if (s.sound) tick()
        }
      }
    }

    createService(settingsStore.get())
      .then((s) => {
        if (cancelled) {
          void s.stop()
          return
        }
        svc = s
        live.current = s
        off = s.on(onEvent)
        setService(s)
        void s.start()
      })
      .catch((err) => {
        if (cancelled) return
        setStatus('error')
        setDetail(String(err))
      })

    return () => {
      cancelled = true
      off()
      if (svc) void svc.stop()
      if (live.current === svc) live.current = null
      setService(null)
      typingTimers.current.forEach(clearTimeout)
      typingTimers.current.clear()
    }
  }, [mode, apiId, apiHash, configured, nonce])

  // Another tab wiped or replaced the session: drop this tab's connection too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY || e.key === null) {
        void live.current?.stop()
        setNonce((n) => n + 1)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const columnIds = settings.columns[mode].map((c) => c.chatId).join('\n')
  useEffect(() => {
    if (!service || status !== 'ready') return
    const ids = columnIds.split('\n').filter(Boolean)
    // A closed column forgets its log, so reopening it fetches fresh history.
    for (const id of [...loaded.current]) {
      if (ids.includes(id)) continue
      loaded.current.delete(id)
      setMessages((all) => without(all, id))
    }
    for (const id of ids) {
      if (loaded.current.has(id)) continue
      loaded.current.add(id)
      service
        .history(id)
        .then((list) => {
          if (live.current !== service || !loaded.current.has(id)) return
          setMessages((all) => {
            const buffered = (own(all, id) ?? []).filter((m) => !list.some((x) => x.id === m.id))
            return { ...all, [id]: list.concat(buffered) }
          })
        })
        .catch((err) => {
          if (live.current !== service) return
          loaded.current.delete(id)
          setMessages((all) => ({ ...all, [id]: own(all, id) ?? [] }))
          setDetail(String(err?.message ?? err))
        })
    }
  }, [service, status, columnIds])

  const send = useCallback(
    async (chatId: string, text: string) => {
      if (!service) throw new Error('Not connected')
      const m = await service.send(chatId, text)
      if (live.current !== service) return
      setMessages((all) => ({ ...all, [chatId]: appendUnique(own(all, chatId) ?? [], m) }))
      setUnread((u) => ({ ...u, [chatId]: 0 }))
    },
    [service],
  )

  const markRead = useCallback(
    (chatId: string) => {
      setUnread((u) => (own(u, chatId) ? { ...u, [chatId]: 0 } : u))
      void service?.markRead(chatId)
    },
    [service],
  )

  const refreshChats = useCallback(async () => {
    if (!service || status !== 'ready') return
    const cs = await service.listChats()
    if (live.current === service) setChats(cs)
  }, [service, status])

  const logout = useCallback(async () => {
    if (!service?.logout) return
    await service.logout()
    void service.stop()
    saveSession('')
    setNonce((n) => n + 1)
  }, [service])

  const wipeSession = useCallback(() => {
    // Stop first: it marks the service dead synchronously, so a login still in flight can't write the session back.
    void live.current?.stop()
    saveSession('')
    setNonce((n) => n + 1)
  }, [])

  return { service, status, detail, chats, messages, typing, unread, send, markRead, refreshChats, logout, wipeSession }
}
