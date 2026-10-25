export function parsePageRanges(input: string, count: number): number[] | null {
  if (!Number.isInteger(count) || count < 1) return null
  const text = input
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
  if (!text || text === 'all') return Array.from({ length: count }, (_, index) => index)
  const selected = new Set<number>()
  for (const part of text.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!match) return null
    const first = Number(match[1]),
      last = Number(match[2] ?? match[1])
    if (first < 1 || last < first || last > count) return null
    for (let page = first; page <= last; page++) selected.add(page - 1)
  }
  return [...selected].sort((a, b) => a - b)
}
