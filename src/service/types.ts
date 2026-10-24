export type ChatKind = 'group' | 'dm' | 'channel'

export interface ChatSummary {
  id: string
  title: string
  kind: ChatKind
  /** Short tab label: `#boys` for groups, `@dave` for people. */
  handle: string
  unread: number
  online?: boolean
  /** A deleted account: its history still shows, but it can't be added to anything. */
  deleted?: boolean
}

export interface NewGroup {
  chat: ChatSummary
  /** People Telegram wouldn't add, usually because of their privacy settings. */
  notAdded: string[]
}

export type MediaKind = 'photo' | 'video' | 'file' | 'sticker' | 'voice' | 'other'

export interface Message {
  id: string
  chatId: string
  senderId: string
  senderName: string
  out: boolean
  /** Epoch milliseconds. */
  date: number
  text: string
  replyTo?: { senderName: string; text: string }
  media?: { kind: MediaKind; label: string }
  /** Join/leave/photo-changed style system lines. */
  service?: boolean
  mentioned?: boolean
}

export type ConnStatus = 'idle' | 'connecting' | 'ready' | 'needs-login' | 'offline' | 'error'

export interface Me {
  id: string
  name: string
}

export type ServiceEvent =
  | { type: 'message'; message: Message }
  | { type: 'edited'; message: Message }
  /** Without a chatId the ids are account-wide (private chats and basic groups). */
  | { type: 'deleted'; chatId?: string; ids: string[] }
  | { type: 'typing'; chatId: string; name: string }
  | { type: 'status'; status: ConnStatus; detail?: string }

export interface LoginSteps {
  /** Sends the login code; resolves with how it was delivered. */
  sendCode(phone: string): Promise<{ viaApp: boolean }>
  /** Resolves 'password' when the account has 2FA and needs it next. */
  signIn(code: string): Promise<'done' | 'password'>
  checkPassword(password: string): Promise<void>
}

export interface ChatService {
  readonly mode: 'demo' | 'telegram'
  start(): Promise<void>
  stop(): Promise<void>
  me(): Me | null
  login(): LoginSteps
  listChats(): Promise<ChatSummary[]>
  /** Oldest first. */
  history(chatId: string, limit?: number): Promise<Message[]>
  send(chatId: string, text: string): Promise<Message>
  markRead(chatId: string): Promise<void>
  /** Makes a group with you and `memberIds` (people from your DMs) in it. */
  createGroup(title: string, memberIds: string[]): Promise<NewGroup>
  /** Ends the account session on the server, where that means anything. */
  logout?(): Promise<void>
  on(listener: (e: ServiceEvent) => void): () => void
}

export class Emitter {
  private listeners = new Set<(e: ServiceEvent) => void>()
  on(listener: (e: ServiceEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  emit(e: ServiceEvent) {
    for (const l of this.listeners) l(e)
  }
}
