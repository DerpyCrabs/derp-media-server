import { parseSubtitles } from './subtitles'
export const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024
export function decodeSubtitleFile(bytes: Uint8Array, name: string) {
  if (!/\.(srt|vtt)$/i.test(name)) throw new Error('Choose an SRT or WebVTT subtitle file.')
  if (bytes.length > MAX_SUBTITLE_BYTES)
    throw new Error('Subtitle files must be smaller than 4 MiB.')
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  let text: string
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    throw new Error(
      'This subtitle file uses an unsupported encoding. Save it as UTF-8 or UTF-16 and try again.',
    )
  }
  if (text.includes('\0'))
    throw new Error('This file contains binary data, not readable subtitles.')
  const cues = parseSubtitles(text)
  if (!cues.length) throw new Error('No readable subtitle cues were found in this file.')
  if (cues.length > 50_000)
    throw new Error('This subtitle file has too many cues (maximum 50,000).')
  return cues
}
