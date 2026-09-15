import type { FileItem } from '@/lib/files/types'

export function shuffleImages(files: FileItem[], seed: string): FileItem[] {
  const result = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  let state = 2166136261
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619)
  }
  for (let i = result.length - 1; i > 0; i--) {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    const j = Math.floor((((value ^ (value >>> 14)) >>> 0) / 4294967296) * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}
