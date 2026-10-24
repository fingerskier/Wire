import { slug } from '../format'
import { Emitter, type ChatService, type ChatSummary, type LoginSteps, type Message, type NewGroup } from './types'

// Everything here is made up. It lets the deck run with no Telegram account.

const ME = { id: 'me', name: 'Matt' }

const PEOPLE: Record<string, string> = {
  dave: 'Dave',
  marcus: 'Marcus',
  tony: 'Tony',
  jay: 'Jay',
  rob: 'Rob',
}

const CHATS: ChatSummary[] = [
  { id: 'boys', title: 'The Boys', kind: 'group', handle: '#boys', unread: 0 },
  { id: 'dave', title: 'Dave', kind: 'dm', handle: '@dave', unread: 0, online: true },
  { id: 'marcus', title: 'Marcus', kind: 'dm', handle: '@marcus', unread: 2, online: true },
  { id: 'tony', title: 'Tony', kind: 'dm', handle: '@tony', unread: 0, online: true },
  { id: 'jay', title: 'Jay', kind: 'dm', handle: '@jay', unread: 0, online: true },
  { id: 'rob', title: 'Rob', kind: 'dm', handle: '@rob', unread: 0, online: false },
  { id: 'golf', title: 'Golf Saturday', kind: 'group', handle: '#golf-sat', unread: 0 },
]

type Seed = [minutesAgo: number, sender: string, text: string, extra?: Partial<Message>]

const SEEDS: Record<string, Seed[]> = {
  boys: [
    [96, 'rob', "whoever has my cooler, it's mine"],
    [95, 'dave', "it's in jay's garage"],
    [89, 'jay', 'anyone watch the game'],
    [87, 'tony', "don't talk to me about the game"],
    [87, 'marcus', 'lmao'],
    [73, 'dave', 'poll: sat tee time? 7:40 (3) · 9:10 (2) · can\'t (1)'],
    [68, 'marcus', '7:40 is criminal'],
    [56, 'me', '7:40 builds character'],
    [54, 'tony', "agreed. 9:10, bringing the speaker", { replyTo: { senderName: 'Marcus', text: '7:40 is criminal' } }],
    [51, 'rob', 'changed the group photo', { service: true }],
    [49, 'rob', "brisket's on after. bring chairs", { media: { kind: 'photo', label: 'grill.jpg 1.2MB' } }],
  ],
  dave: [
    [160, 'dave', 'you still have my driver?'],
    [158, 'me', "it's in my trunk. bringing it saturday"],
    [158, 'dave', "bring it or don't come"],
    [157, 'dave', 'also loser buys breakfast'],
  ],
  marcus: [
    [250, 'me', 'wings thursday?'],
    [230, 'marcus', 'always'],
    [40, 'marcus', 'did you see that trade'],
    [39, 'marcus', "call me when you're free, need your take"],
  ],
  tony: [
    [118, 'tony', "speaker's charged"],
    [115, 'me', "bring the small one. the big one's a menace"],
    [114, 'tony', 'no promises'],
  ],
  jay: [[600, 'jay', 'garage code is the usual']],
  rob: [[1500, 'rob', 'chairs are in the shed']],
  golf: [[3000, 'dave', 'tee sheet is up, sign in by friday']],
}

const REPLIES: Record<string, string[]> = {
  dave: ['bet', 'say less', "that's what i'm saying", 'nah', 'you buying?'],
  marcus: ['lmao', 'no shot', 'facts', 'call me', "i'm in"],
  tony: ['speaker says yes', 'absolutely not', 'ok fine', 'who invited you'],
  jay: ['on my way', 'garage is open', '10 min', 'bring ice'],
  rob: ["brisket's resting", 'chairs?', 'sure', "i'll bring the cooler"],
}

let seq = 1000
const nextId = () => String(++seq)

export class DemoService implements ChatService {
  readonly mode = 'demo' as const
  private events = new Emitter()
  private store = new Map<string, Message[]>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  /** Groups made this session. Like everything else here they're gone on reload. */
  private made: ChatSummary[] = []
  private members = new Map<string, string[]>()

  constructor() {
    const now = Date.now()
    for (const [chatId, seeds] of Object.entries(SEEDS)) {
      this.store.set(
        chatId,
        seeds.map(([ago, sender, text, extra]) => ({
          id: nextId(),
          chatId,
          senderId: sender,
          senderName: sender === 'me' ? ME.name : PEOPLE[sender],
          out: sender === 'me',
          date: now - ago * 60_000,
          text,
          ...extra,
        })),
      )
    }
  }

  async start() {
    this.events.emit({ type: 'status', status: 'connecting' })
    this.later(250, () => this.events.emit({ type: 'status', status: 'ready' }))
    this.ambient()
  }

  async stop() {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
  }

  me() {
    return ME
  }

  login(): LoginSteps {
    const ok = async () => {}
    return { sendCode: async () => ({ viaApp: true }), signIn: async () => 'done', checkPassword: ok }
  }

  async listChats() {
    return [...this.made, ...CHATS].map((c) => ({ ...c }))
  }

  async history(chatId: string) {
    return [...(this.store.get(chatId) ?? [])]
  }

  async send(chatId: string, text: string) {
    const m: Message = { id: nextId(), chatId, senderId: ME.id, senderName: ME.name, out: true, date: Date.now(), text }
    this.push(m)
    this.replyTo(chatId)
    return m
  }

  async markRead() {}

  async createGroup(title: string, memberIds: string[]): Promise<NewGroup> {
    // Columns outlive a reload but `seq` restarts, so the id must not come from it.
    const id = `group-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const chat: ChatSummary = { id, title, kind: 'group', handle: '#' + slug(title), unread: 0 }
    const crowd = memberIds.filter((m) => Object.hasOwn(PEOPLE, m))
    this.made.unshift(chat)
    this.members.set(chat.id, crowd)
    this.push({ id: nextId(), chatId: chat.id, senderId: ME.id, senderName: ME.name, out: true, date: Date.now(), text: 'created the group', service: true })
    if (crowd.length) this.replyTo(chat.id)
    return { chat: { ...chat }, notAdded: [] }
  }

  on(listener: Parameters<ChatService['on']>[0]) {
    return this.events.on(listener)
  }

  private push(m: Message) {
    const list = this.store.get(m.chatId) ?? []
    list.push(m)
    this.store.set(m.chatId, list)
  }

  private replyTo(chatId: string) {
    const chat = [...this.made, ...CHATS].find((c) => c.id === chatId)
    if (!chat) return
    const crowd = this.members.get(chatId) ?? Object.keys(PEOPLE)
    if (!crowd.length) return
    const who = chat.kind === 'dm' ? chatId : pick(crowd)
    this.later(900 + Math.random() * 1200, () => {
      this.events.emit({ type: 'typing', chatId, name: PEOPLE[who] })
      this.later(1500 + Math.random() * 1500, () => this.incoming(chatId, who, pick(REPLIES[who])))
    })
  }

  private incoming(chatId: string, who: string, text: string) {
    const m: Message = { id: nextId(), chatId, senderId: who, senderName: PEOPLE[who], out: false, date: Date.now(), text }
    this.push(m)
    this.events.emit({ type: 'message', message: m })
  }

  /** Every so often somebody says something in the group without being asked. */
  private ambient() {
    this.later(45_000 + Math.random() * 45_000, () => {
      const who = pick(Object.keys(PEOPLE))
      this.events.emit({ type: 'typing', chatId: 'boys', name: PEOPLE[who] })
      this.later(2000, () => this.incoming('boys', who, pick(REPLIES[who])))
      this.ambient()
    })
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }
}

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]
}
