import { decodeHTML } from 'entities'

export type SubtitleCue = { start: number; end: number; text: string }

function timestamp(value: string): number {
  const parts = value.replace(',', '.').split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3)
    return Number.NaN
  return parts.reduce((seconds, part) => seconds * 60 + part, 0)
}

export function parseSubtitles(vtt: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  for (const block of vtt.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.trim().split('\n')
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0] ?? '')) continue
    const timing = lines.findIndex((line) => line.includes(' --> '))
    if (timing < 0) continue
    const match = /^(\S+)\s+-->\s+(\S+)/.exec(lines[timing])
    if (!match) continue
    const start = timestamp(match[1])
    const end = timestamp(match[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    const text = decodeHTML(
      lines
        .slice(timing + 1)
        .join('\n')
        .replace(/<[^>]*>/g, ''),
    ).trim()
    if (text) cues.push({ start, end, text })
  }
  return cues.sort((left, right) => left.start - right.start)
}

export function subtitleText(cues: readonly SubtitleCue[], position: number): string {
  const text: string[] = []
  for (const cue of cues) {
    if (cue.start > position) break
    if (position < cue.end) text.push(cue.text)
  }
  return text.join('\n')
}
