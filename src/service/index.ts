import { loadSession, saveSession, type Settings } from '../settings'
import { DemoService } from './demo'
import type { ChatService } from './types'

export async function createService(s: Settings): Promise<ChatService> {
  if (s.mode === 'telegram') {
    // GramJS is most of the bundle; only fetch it when someone actually connects.
    const { TelegramService } = await import('./telegram')
    return new TelegramService(Number(s.apiId), s.apiHash, loadSession(), saveSession)
  }
  return new DemoService()
}
