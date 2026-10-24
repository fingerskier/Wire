let audio: AudioContext | null = null

/** A short synthesized tick: no audio files to ship or cache. */
export function tick() {
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(1400, t)
    gain.gain.setValueAtTime(0.06, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + 0.07)
  } catch {
    // Audio blocked until a user gesture; skip this one.
  }
}

export function canNotify() {
  return 'Notification' in window
}

export async function askToNotify() {
  if (canNotify() && Notification.permission === 'default') await Notification.requestPermission()
}

export function showNotification(title: string, body: string, tag: string) {
  if (!canNotify() || Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, tag, icon: './icon.svg' })
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}
