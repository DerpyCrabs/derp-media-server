export type SourceLineSeparator = '\n' | '\r\n' | '\r'

export function detectLineSeparator(
  content: string,
  fallback: SourceLineSeparator = '\n',
): SourceLineSeparator {
  return (/\r\n|\r|\n/.exec(content)?.[0] as SourceLineSeparator | undefined) ?? fallback
}

export function hasMixedLineEndings(source: string): boolean {
  let first: string | null = null
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    if (first === null) first = match[0]
    else if (match[0] !== first) return true
  }
  return false
}
