export function parsePlaybackTime(input: string): number | null {
  const text = input.trim()
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(text)) return null
  const parts = text.split(':').map(Number)
  if (parts.length > 1 && parts.slice(1).some((part) => part >= 60)) return null
  const value = parts.reduce((sum, part) => sum * 60 + part, 0)
  return Number.isFinite(value) ? value : null
}
export function precisePlaybackTime(seconds: number): string {
  const value = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(value / 3_600_000),
    minutes = Math.floor(value / 60_000) % 60,
    wholeSeconds = Math.floor(value / 1000) % 60,
    fraction = value % 1000
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(hours ? 2 : 1, '0')}:${String(wholeSeconds).padStart(2, '0')}${fraction ? `.${String(fraction).padStart(3, '0').replace(/0+$/, '')}` : ''}`
}
export function chapterAt(chapters: readonly { start: number }[], position: number): number {
  let low = 0,
    high = chapters.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (chapters[middle]!.start <= position + 0.05) low = middle + 1
    else high = middle
  }
  return low - 1
}
