import { buildMediaUrl } from '@/lib/media/build-media-url'
export const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024
export type PlaylistEntry = { value: string; logical: boolean }
export type ParsedPlaylist = { name: string; entries: PlaylistEntry[] }
export function decodePlaylist(bytes: Uint8Array): string {
  if (bytes.byteLength > PLAYLIST_MAX_BYTES)
    throw new Error('Playlist files must be smaller than 2 MiB.')
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    if (text.includes('\0')) throw new Error('binary')
    return text
  } catch {
    throw new Error(
      'This playlist is not valid UTF-8 or UTF-16 text. Export it as UTF-8 and try again.',
    )
  }
}
function entry(value: string, origin: string, uri = false): PlaylistEntry {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed, origin)
    if (
      (/^https?:/i.test(trimmed) || trimmed.startsWith('/api/media/')) &&
      url.origin === new URL(origin).origin &&
      url.pathname.startsWith('/api/media/')
    )
      return { value: decodeURIComponent(url.pathname.slice('/api/media/'.length)), logical: true }
  } catch {}
  if (uri && !/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    try {
      return { value: decodeURIComponent(trimmed.split(/[?#]/, 1)[0]!), logical: false }
    } catch {
      return { value: trimmed, logical: false }
    }
  }
  return { value: trimmed, logical: false }
}
export function parsePlaylist(text: string, filename: string, origin: string): ParsedPlaylist {
  const source = text.replace(/^\ufeff/, '')
  if (new TextEncoder().encode(source).byteLength > PLAYLIST_MAX_BYTES)
    throw new Error('Playlist files must be smaller than 2 MiB.')
  let name = filename.replace(/\.(m3u8?|pls|xspf)$/i, '')
  let values: string[] = []
  let uri = false
  if (/\.xspf$/i.test(filename) || /^\s*<\?xml|^\s*<playlist\b/i.test(source)) {
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source))
      throw new Error('Playlists with XML document types or entities are not supported.')
    const xml = new DOMParser().parseFromString(source, 'application/xml')
    if (
      xml.getElementsByTagName('parsererror').length ||
      xml.documentElement.localName !== 'playlist'
    )
      throw new Error('This XSPF playlist could not be read.')
    name =
      [...xml.documentElement.children]
        .find((child) => child.localName === 'title')
        ?.textContent?.trim() || name
    values = [...xml.getElementsByTagNameNS('*', 'track')]
      .map((track) => track.getElementsByTagNameNS('*', 'location')[0]?.textContent?.trim() ?? '')
      .filter(Boolean)
    uri = true
  } else if (/\.pls$/i.test(filename) || /^\s*\[playlist\]/i.test(source)) {
    const files = new Map<number, string>()
    for (const line of source.split(/\r\n|\n|\r/)) {
      const match = /^File(\d+)\s*=(.*)$/i.exec(line.trim())
      if (match) files.set(Number(match[1]), match[2]!.trim())
    }
    values = [...files]
      .sort(([a], [b]) => a - b)
      .map(([, value]) => value)
      .filter(Boolean)
  } else {
    for (const line of source.split(/\r\n|\n|\r/)) {
      const value = line.trim()
      if (/^#EXT-X-/i.test(value))
        throw new Error('This is an HLS streaming manifest, not a saved music playlist.')
      if (/^#PLAYLIST:/i.test(value)) name = value.slice('#PLAYLIST:'.length).trim() || name
      if (value && !value.startsWith('#')) values.push(value)
    }
  }
  if (!values.length) throw new Error('This playlist contains no file entries.')
  if (values.length > 10_000) throw new Error('Playlists can contain at most 10,000 entries.')
  if (values.some((value) => value.length > 8192)) throw new Error('A playlist entry is too long.')
  let title = ''
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)) {
    if (title.length + part.segment.length > 160) break
    title += part.segment
  }
  return { name: title, entries: values.map((value) => entry(value, origin, uri)) }
}
const singleLine = (value: string) => value.replace(/[\r\n]/g, ' ')
export function exportM3u(
  name: string,
  entries: readonly { url: string; title: string; duration?: number | null }[],
): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${singleLine(name)}`]
  for (const item of entries) {
    if (!item.url || /[\r\n]/.test(item.url))
      throw new Error('A playlist entry contains an invalid URL.')
    lines.push(
      `#EXTINF:${item.duration && Number.isFinite(item.duration) && item.duration > 0 ? Math.round(item.duration) : -1},${singleLine(item.title)}`,
      item.url,
    )
  }
  return `${lines.join('\n')}\n`
}
export function serverPlaylist(
  name: string,
  tracks: readonly { path: string; title: string; duration?: number | null }[],
  origin: string,
): string {
  return exportM3u(
    name,
    tracks.map((track) => ({ ...track, url: new URL(buildMediaUrl(track.path), origin).href })),
  )
}
export function playlistFilename(name: string): string {
  let stem =
    name
      .replace(/[\\/<>:"|?*]/g, '_')
      .replace(/\p{Cc}/gu, '')
      .trim() || 'Playlist'
  const characters = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stem),
    (part) => part.segment,
  )
  while (new TextEncoder().encode(characters.join('')).byteLength > 180) characters.pop()
  stem = characters.join('') || 'Playlist'
  return `${stem}.m3u8`
}
