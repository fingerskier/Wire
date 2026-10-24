export function clockTime(ms: number, clock: '24h' | '12h') {
  const d = new Date(ms)
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  if (clock === '24h') return `${String(h).padStart(2, '0')}:${m}`
  return `${h % 12 || 12}:${m}${h < 12 ? 'a' : 'p'}`
}

export function dayKey(ms: number) {
  return new Date(ms).toDateString()
}

export function dayLabel(ms: number) {
  return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toLowerCase()
}

/** The short name shown in the handle column: first word, lower case. */
export function shortName(name: string) {
  return (name.trim().split(/\s+/)[0] || '?').toLowerCase().slice(0, 12)
}

const COLORS_KEY = 'wire:colors'
const PALETTE_SIZE = 6
let colorMap: Record<string, number> | null = null

/**
 * Each person keeps one of six colors everywhere. Colors are handed out
 * least-used first and remembered, so a crew of five or six never collides
 * the way a hash would.
 */
export function colorIndex(id: string) {
  if (!colorMap) {
    try {
      colorMap = JSON.parse(localStorage.getItem(COLORS_KEY) || '{}') as Record<string, number>
    } catch {
      colorMap = {}
    }
  }
  let i = colorMap[id]
  if (i === undefined) {
    const counts = new Array<number>(PALETTE_SIZE).fill(0)
    for (const v of Object.values(colorMap)) counts[v % PALETTE_SIZE]++
    i = counts.indexOf(Math.min(...counts))
    colorMap[id] = i
    try {
      localStorage.setItem(COLORS_KEY, JSON.stringify(colorMap))
    } catch {
      // Not persisted; colors may shuffle next visit.
    }
  }
  return i % PALETTE_SIZE
}

export function resetColors() {
  colorMap = {}
  try {
    localStorage.removeItem(COLORS_KEY)
  } catch {
    // ignore
  }
}
