import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { NewMessage, Raw, type NewMessageEvent } from 'telegram/events'
import { EditedMessage, type EditedMessageEvent } from 'telegram/events/EditedMessage'
import { DeletedMessage, type DeletedMessageEvent } from 'telegram/events/DeletedMessage'
import { LogLevel } from 'telegram/extensions/Logger'
import { getDisplayName, getPeerId } from 'telegram/Utils'
import type { Entity } from 'telegram/define'
import { slug } from '../format'
import { Emitter, type ChatKind, type ChatService, type ChatSummary, type LoginSteps, type Me, type Message, type NewGroup, type ServiceEvent } from './types'

/**
 * MTProto user client (GramJS) over WebSocket, straight from the browser to
 * Telegram. The session string is handed to `onSession` so the app can keep
 * it in localStorage; nothing passes through any other server.
 */
export class TelegramService implements ChatService {
  readonly mode = 'telegram' as const
  private client: TelegramClient
  private session: StringSession
  private events = new Emitter()
  private entities = new Map<string, Entity>()
  private titles = new Map<string, string>()
  private meInfo: Me | null = null
  private phone = ''
  private phoneCodeHash = ''
  private handlersOn = false
  /** Set the moment the app lets go of this service; late async work must not touch app state after that. */
  private disposed = false
  private readonly apiId: number
  private readonly apiHash: string
  private readonly onSession: (session: string) => void

  constructor(apiId: number, apiHash: string, session: string, onSession: (session: string) => void) {
    this.apiId = apiId
    this.apiHash = apiHash
    this.onSession = onSession
    this.session = new StringSession(session)
    this.client = new TelegramClient(this.session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true,
      deviceModel: 'Wire (browser)',
      appVersion: '0.1.0',
      systemVersion: 'Web',
    })
    this.client.setLogLevel(LogLevel.ERROR)
  }

  async start() {
    this.emit({ type: 'status', status: 'connecting' })
    try {
      await this.client.connect()
      if (this.disposed) return
      if (await this.client.checkAuthorization()) await this.ready()
      else this.emit({ type: 'status', status: 'needs-login' })
    } catch (err) {
      this.emit({ type: 'status', status: 'error', detail: errorText(err) })
    }
  }

  /** Synchronously marks the service dead before awaiting anything, so an in-flight login can't re-save a wiped session. */
  async stop() {
    if (this.disposed) return
    this.disposed = true
    if (this.handlersOn) {
      this.client.removeEventHandler(this.onNewMessage, new NewMessage({}))
      this.client.removeEventHandler(this.onEdited, new EditedMessage({}))
      this.client.removeEventHandler(this.onDeleted, new DeletedMessage({}))
      this.client.removeEventHandler(this.onRaw, new Raw({}))
      this.handlersOn = false
    }
    await this.client.destroy().catch(() => {})
  }

  /** Ends the authorization on Telegram's side. Throws (and keeps the session) if Telegram didn't confirm. */
  async logout() {
    await this.client.invoke(new Api.auth.LogOut())
    this.onSession('')
  }

  me() {
    return this.meInfo
  }

  login(): LoginSteps {
    const creds = { apiId: this.apiId, apiHash: this.apiHash }
    return {
      sendCode: async (phone) => {
        this.phone = phone.replace(/[^\d+]/g, '')
        const r = await this.client.sendCode(creds, this.phone)
        this.phoneCodeHash = r.phoneCodeHash
        return { viaApp: r.isCodeViaApp }
      },
      signIn: async (code) => {
        try {
          const r = await this.client.invoke(
            new Api.auth.SignIn({ phoneNumber: this.phone, phoneCodeHash: this.phoneCodeHash, phoneCode: code.trim() }),
          )
          if (r instanceof Api.auth.AuthorizationSignUpRequired) {
            throw new Error('There is no Telegram account for this number. Sign up in a Telegram app first.')
          }
        } catch (err) {
          if (errorText(err).includes('SESSION_PASSWORD_NEEDED')) return 'password'
          throw err
        }
        await this.ready()
        return 'done'
      },
      checkPassword: async (password) => {
        let failure: unknown
        try {
          await this.client.signInWithPassword(creds, {
            password: async () => password,
            onError: async (err) => {
              failure = err
              return true
            },
          })
        } catch (err) {
          throw failure ?? err
        }
        if (failure) throw failure
        await this.ready()
      },
    }
  }

  /** Without a limit this pages through every dialog, so chats far down the list can still be columns. */
  async listChats(limit?: number): Promise<ChatSummary[]> {
    const dialogs = await this.client.getDialogs(limit ? { limit } : {})
    const out: ChatSummary[] = []
    for (const d of dialogs) {
      if (!d.entity || d.id === undefined) continue
      const id = d.id.toString()
      const kind: ChatKind = d.isUser ? 'dm' : d.isChannel && !d.isGroup ? 'channel' : 'group'
      const title = d.title || d.name || 'untitled'
      this.entities.set(id, d.entity)
      this.titles.set(id, title)
      out.push({
        id,
        title,
        kind,
        handle: handleFor(kind, d.entity, title),
        unread: d.unreadCount,
        online: d.entity instanceof Api.User ? d.entity.status instanceof Api.UserStatusOnline : undefined,
        deleted: (d.entity instanceof Api.User && d.entity.deleted) || undefined,
      })
    }
    return out
  }

  async history(chatId: string, limit = 60): Promise<Message[]> {
    const entity = await this.peer(chatId)
    const msgs = [...(await this.client.getMessages(entity, { limit }))].reverse()
    const byId = new Map<number, Api.Message>(msgs.map((m) => [m.id, m]))
    const missing = [...new Set(msgs.map((m) => m.replyToMsgId).filter((id): id is number => !!id && !byId.has(id)))]
    if (missing.length) {
      try {
        for (const m of await this.client.getMessages(entity, { ids: missing })) if (m) byId.set(m.id, m)
      } catch {
        // Reply previews are a nicety; show the line without them.
      }
    }
    return msgs.map((m) => this.convert(m, chatId, m.replyToMsgId ? byId.get(m.replyToMsgId) : undefined))
  }

  async send(chatId: string, text: string) {
    const entity = await this.peer(chatId)
    const m = await this.client.sendMessage(entity, { message: text, parseMode: false })
    return this.convert(m, chatId)
  }

  async markRead(chatId: string) {
    const entity = this.entities.get(chatId)
    if (entity) await this.client.markAsRead(entity).catch(() => {})
  }

  async createGroup(title: string, memberIds: string[]): Promise<NewGroup> {
    // A supergroup, not a basic group: it can start with just you, and Telegram never migrates it to a new id later.
    const updates = await this.client.invoke(new Api.channels.CreateChannel({ megagroup: true, title, about: '' }))
    const channel = 'chats' in updates ? updates.chats.find((c) => c instanceof Api.Channel) : undefined
    if (!(channel instanceof Api.Channel)) throw new Error('Telegram made the group but did not say which one. Reopen + column to find it.')
    const id = getPeerId(channel)
    this.entities.set(id, channel)
    this.titles.set(id, title)
    const nameOf = (userId: string) => this.titles.get(userId) ?? userId
    const users = memberIds.flatMap((m) => this.entities.get(m) ?? [])
    let notAdded = memberIds.filter((m) => !this.entities.has(m)).map(nameOf)
    if (users.length) {
      try {
        const invited = await this.client.invoke(new Api.channels.InviteToChannel({ channel, users }))
        notAdded = notAdded.concat(invited.missingInvitees.map((m) => nameOf(m.userId.toString())))
      } catch {
        // The group exists either way, so say who's missing instead of failing the whole thing.
        notAdded = memberIds.map(nameOf)
      }
    }
    return { chat: { id, title, kind: 'group', handle: handleFor('group', channel, title), unread: 0 }, notAdded }
  }

  on(listener: Parameters<ChatService['on']>[0]) {
    return this.events.on(listener)
  }

  private async ready() {
    const me = await this.client.getMe()
    if (this.disposed) return
    this.meInfo = { id: me.id.toString(), name: [me.firstName, me.lastName].filter(Boolean).join(' ') || me.username || 'me' }
    this.onSession(this.session.save())
    // Warm the entity cache with the most recent chats; peer() pages further on demand.
    await this.listChats(100)
    if (this.disposed) return
    if (!this.handlersOn) {
      this.client.addEventHandler(this.onNewMessage, new NewMessage({}))
      this.client.addEventHandler(this.onEdited, new EditedMessage({}))
      this.client.addEventHandler(this.onDeleted, new DeletedMessage({}))
      this.client.addEventHandler(this.onRaw, new Raw({}))
      this.handlersOn = true
    }
    this.emit({ type: 'status', status: 'ready' })
  }

  private emit(e: ServiceEvent) {
    if (!this.disposed) this.events.emit(e)
  }

  private async peer(chatId: string) {
    let entity = this.entities.get(chatId)
    if (!entity) {
      await this.listChats()
      entity = this.entities.get(chatId)
    }
    if (!entity) throw new Error('That chat is not in your Telegram dialogs any more.')
    return entity
  }

  private onNewMessage = async (event: NewMessageEvent) => {
    const m = event.message
    const chatId = m.chatId?.toString()
    if (!chatId) return
    try {
      if (!m.sender) await m.getSender()
      if (!this.entities.has(chatId)) {
        const chat = await m.getChat()
        if (chat) this.entities.set(chatId, chat)
      }
      const reply = m.replyToMsgId ? await m.getReplyMessage() : undefined
      this.emit({ type: 'message', message: this.convert(m, chatId, reply) })
    } catch {
      this.emit({ type: 'message', message: this.convert(m, chatId) })
    }
  }

  private onEdited = async (event: EditedMessageEvent) => {
    const m = event.message
    const chatId = m.chatId?.toString()
    if (!chatId) return
    try {
      if (!m.sender) await m.getSender()
    } catch {
      // Name falls back to the chat title.
    }
    this.emit({ type: 'edited', message: this.convert(m, chatId) })
  }

  private onDeleted = (event: DeletedMessageEvent) => {
    // Telegram only names the chat for channels and supergroups.
    const chatId = event.peer ? getPeerId(event.peer) : undefined
    this.emit({ type: 'deleted', chatId, ids: event.deletedIds.map(String) })
  }

  private onRaw = async (update: unknown) => {
    // NewMessage skips service messages (joins, renames…); pick them up here.
    if ((update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage) && update.message instanceof Api.MessageService) {
      const m = update.message
      const chatId = getPeerId(m.peerId)
      let senderName = this.titles.get(chatId) ?? 'someone'
      if (m.fromId) {
        try {
          senderName = getDisplayName(await this.client.getEntity(m.fromId)) || senderName
        } catch {
          // Unknown sender: keep the fallback.
        }
      }
      this.emit({
        type: 'message',
        message: {
          id: String(m.id),
          chatId,
          senderId: m.fromId ? getPeerId(m.fromId) : chatId,
          senderName,
          out: !!m.out,
          date: m.date * 1000,
          text: describeAction(m.action),
          service: true,
        },
      })
      return
    }
    let chatId: string | undefined
    let from: Api.TypePeer | undefined
    if (update instanceof Api.UpdateUserTyping) {
      chatId = update.userId.toString()
      from = new Api.PeerUser({ userId: update.userId })
    } else if (update instanceof Api.UpdateChatUserTyping) {
      chatId = getPeerId(new Api.PeerChat({ chatId: update.chatId }))
      from = update.fromId
    } else if (update instanceof Api.UpdateChannelUserTyping) {
      chatId = getPeerId(new Api.PeerChannel({ channelId: update.channelId }))
      from = update.fromId
    }
    if (!chatId || !from) return
    let name = 'someone'
    try {
      name = getDisplayName(await this.client.getEntity(from)) || name
    } catch {
      // Unknown user: keep the generic name.
    }
    this.emit({ type: 'typing', chatId, name })
  }

  private convert(m: Api.Message, chatId: string, reply?: Api.Message): Message {
    const service = (m.className as string) === 'MessageService'
    const senderName = m.out
      ? (this.meInfo?.name ?? 'me')
      : m.sender
        ? getDisplayName(m.sender) || 'unknown'
        : (this.titles.get(chatId) ?? 'unknown')
    return {
      id: String(m.id),
      chatId,
      senderId: m.senderId?.toString() ?? chatId,
      senderName,
      out: !!m.out,
      date: m.date * 1000,
      text: service ? describeAction(m.action) : (m.message ?? ''),
      service,
      mentioned: !!m.mentioned,
      media: service ? undefined : mediaOf(m),
      replyTo: reply
        ? { senderName: reply.out ? (this.meInfo?.name ?? 'me') : reply.sender ? getDisplayName(reply.sender) : '', text: (reply.message || '[media]').slice(0, 90) }
        : m.replyToMsgId
          ? { senderName: '', text: 'an earlier message' }
          : undefined,
    }
  }
}

function handleFor(kind: ChatKind, entity: Entity, title: string) {
  if (kind === 'dm') {
    const user = entity as Api.User
    return '@' + (user.username ? user.username.toLowerCase() : slug(user.firstName || title))
  }
  return '#' + slug(title)
}

function mediaOf(m: Api.Message): Message['media'] {
  if (!m.media || m.media instanceof Api.MessageMediaEmpty) return undefined
  if (m.photo) return { kind: 'photo', label: 'photo' }
  if (m.sticker) return { kind: 'sticker', label: 'sticker' }
  if (m.voice) return { kind: 'voice', label: 'voice message' }
  if (m.video) return { kind: 'video', label: 'video' }
  if (m.document) return { kind: 'file', label: m.file?.name || 'file' }
  if (m.media instanceof Api.MessageMediaPoll) {
    const q = m.media.poll.question as unknown
    return { kind: 'other', label: 'poll: ' + (typeof q === 'string' ? q : ((q as { text?: string })?.text ?? '')) }
  }
  if (m.media instanceof Api.MessageMediaWebPage) return undefined
  return { kind: 'other', label: m.media.className.replace(/^MessageMedia/, '').toLowerCase() }
}

function describeAction(action: Api.TypeMessageAction | undefined) {
  if (!action) return 'did something'
  if (action instanceof Api.MessageActionChannelCreate || action instanceof Api.MessageActionChatCreate) return 'created the group'
  if (action instanceof Api.MessageActionChatAddUser || action instanceof Api.MessageActionChatJoinedByLink) return 'joined'
  if (action instanceof Api.MessageActionChatDeleteUser) return 'left'
  if (action instanceof Api.MessageActionChatEditPhoto) return 'changed the group photo'
  if (action instanceof Api.MessageActionChatEditTitle) return `renamed the group to "${action.title}"`
  if (action instanceof Api.MessageActionPinMessage) return 'pinned a message'
  return action.className.replace(/^MessageAction/, '').toLowerCase()
}

export function errorText(err: unknown) {
  if (err && typeof err === 'object') {
    const e = err as { errorMessage?: string; message?: string }
    return e.errorMessage || e.message || String(err)
  }
  return String(err)
}
