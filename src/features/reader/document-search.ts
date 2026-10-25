export type DocumentMatch = { page: number; from: number; to: number; excerpt: string }
export function findDocumentMatches(
  text: string,
  query: string,
  page: number,
  limit = 10000,
): DocumentMatch[] {
  if (!query.trim()) return []
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches: DocumentMatch[] = []
  for (const match of text.matchAll(new RegExp(escaped, 'giu'))) {
    if (matches.length >= limit) break
    matches.push({
      page,
      from: match.index,
      to: match.index + match[0].length,
      excerpt: text
        .slice(Math.max(0, match.index - 35), match.index + match[0].length + 65)
        .replace(/\s+/g, ' '),
    })
  }
  return matches
}
