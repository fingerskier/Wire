import { useCallback, useEffect, useRef, useState } from 'react'
import { createService } from './service'
import type { ChatService, ChatSummary, ConnStatus, Message, ServiceEvent } from './service/types'
import { saveSession, settingsStore, type Settings } from './settings'
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
  logout(): Promise<void>
  wipeSession(): void
}

const TYPING_MS = 6000

function appendUnique(list: Message[], m: Message) {
  return list.some((x) => x.id === m.id) ? list : [...list, m]
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
      setTyping((t) => {
        if (!(chatId in t)) return t
        const { [chatId]: _, ...rest } = t
        return rest
      })
    }

    const onEvent = (e: ServiceEvent) => {
      if (e.type === 'status') {
        setStatus(e.status)
        setDetail(e.detail)
        if (e.status === 'ready' && svc) {
          svc
            .listChats()
            .then((cs) => {
              if (cancelled) return
              setChats(cs)
              setUnread((u) => {
                const next = { ...u }
                for (const c of cs) if (c.unread && next[c.id] === undefined) next[c.id] = c.unread
                return next
              })
            })
            .catch(() => {})
        }
      } else if (e.type === 'typing') {
        setTyping((t) => ({ ...t, [e.chatId]: e.name }))
        clearTimeout(typingTimers.current.get(e.chatId))
        typingTimers.current.set(
          e.chatId,
          setTimeout(() => clearTyping(e.chatId), TYPING_MS),
        )
      } else {
        const m = e.message
        const s = settingsStore.get()
        const column = s.columns[s.mode].find((c) => c.chatId === m.chatId)
        if (!column) return
        setMessages((all) => (all[m.chatId] ? { ...all, [m.chatId]: appendUnique(all[m.chatId], m) } : all))
        clearTyping(m.chatId)
        if (m.out) return
        // Typing in that column right now: it's already read.
        const watching = !document.hidden && !!document.getElementById(`col-${m.chatId}`)?.contains(document.activeElement)
        if (watching) void svc?.markRead(m.chatId)
        else setUnread((u) => ({ ...u, [m.chatId]: (u[m.chatId] ?? 0) + 1 }))
        const wants = s.notify === 'all' || (s.notify === 'mentions' && (column.kind === 'dm' || m.mentioned))
        if (wants && document.hidden) showNotification(column.title, `${m.senderName}: ${m.text || m.media?.label || ''}`, m.chatId)
        if (s.sound) tick()
      }
    }

    createService(settingsStore.get())
      .then((s) => {
        if (cancelled) {
          void s.stop()
          return
        }
        svc = s
        off = s.on(onEvent)
        setService(s)
        void s.start()
      })
      .catch((err) => {
        setStatus('error')
        setDetail(String(err))
      })

    return () => {
      cancelled = true
      off()
      if (svc) void svc.stop()
      setService(null)
      typingTimers.current.forEach(clearTimeout)
      typingTimers.current.clear()
    }
  }, [mode, apiId, apiHash, configured, nonce])

  const columnIds = settings.columns[mode].map((c) => c.chatId).join('\n')
  useEffect(() => {
    if (!service || status !== 'ready') return
    for (const id of columnIds.split('\n').filter(Boolean)) {
      if (loaded.current.has(id)) continue
      loaded.current.add(id)
      service
        .history(id)
        .then((list) => setMessages((all) => ({ ...all, [id]: list.concat((all[id] ?? []).filter((m) => !list.some((x) => x.id === m.id))) })))
        .catch((err) => {
          loaded.current.delete(id)
          setMessages((all) => ({ ...all, [id]: all[id] ?? [] }))
          setDetail(String(err?.message ?? err))
        })
    }
  }, [service, status, columnIds])

  const send = useCallback(
    async (chatId: string, text: string) => {
      if (!service) throw new Error('Not connected')
      const m = await service.send(chatId, text)
      setMessages((all) => ({ ...all, [chatId]: appendUnique(all[chatId] ?? [], m) }))
      setUnread((u) => ({ ...u, [chatId]: 0 }))
    },
    [service],
  )

  const markRead = useCallback(
    (chatId: string) => {
      setUnread((u) => (u[chatId] ? { ...u, [chatId]: 0 } : u))
      void service?.markRead(chatId)
    },
    [service],
  )

  const refreshChats = useCallback(async () => {
    if (service && status === 'ready') setChats(await service.listChats())
  }, [service, status])

  const logout = useCallback(async () => {
    try {
      await service?.logout?.()
    } finally {
      saveSession('')
      setNonce((n) => n + 1)
    }
  }, [service])

  const wipeSession = useCallback(() => {
    saveSession('')
    setNonce((n) => n + 1)
  }, [])

  return { service, status, detail, chats, messages, typing, unread, send, markRead, refreshChats, logout, wipeSession }
}
