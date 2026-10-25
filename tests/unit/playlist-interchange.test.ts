import { expect, test } from 'bun:test'
import {
  decodePlaylist,
  exportM3u,
  parsePlaylist,
  playlistFilename,
  serverPlaylist,
} from '../../src/features/music/playlist-interchange'
test('M3U and PLS keep order, Unicode and raw local paths without treating options as commands', () => {
  const parsed = parsePlaylist(
    '\ufeff#EXTM3U\r\n#PLAYLIST:Вечер\r\n#EXTINF:3,First\r\nMusic/100% song.mp3\r\n#EXTVLCOPT:http-referrer=ignored\r\n../other.flac\r\nfile:///home/me/song%20two.mp3\r\n',
    'list.m3u',
    'https://music.test',
  )
  expect(parsed.name).toBe('Вечер')
  expect(parsed.entries).toEqual([
    { value: 'Music/100% song.mp3', logical: false },
    { value: '../other.flac', logical: false },
    { value: 'file:///home/me/song%20two.mp3', logical: false },
  ])
  expect(
    parsePlaylist(
      '[playlist]\nFile2=second.mp3\nTitle2=Second\nFile1=first.flac\nNumberOfEntries=2',
      'list.pls',
      'https://music.test',
    ).entries.map((item) => item.value),
  ).toEqual(['first.flac', 'second.mp3'])
})
test('server URL exports round trip without decoding unrelated origins or executing injected lines', () => {
  const text = serverPlaylist(
    'Evening\n#bad',
    [{ path: 'Музыка/a #b.mp3', title: 'A\r\nB', duration: 12.7 }],
    'https://music.test',
  )
  expect(text).toContain('#PLAYLIST:Evening #bad\n#EXTINF:13,A  B\n')
  expect(parsePlaylist(text, 'list.m3u8', 'https://music.test').entries).toEqual([
    { value: 'Музыка/a #b.mp3', logical: true },
  ])
  expect(
    parsePlaylist('https://other.test/api/media/song.mp3', 'list.m3u8', 'https://music.test')
      .entries[0]?.logical,
  ).toBe(false)
  expect(() => exportM3u('x', [{ url: 'file:///a\nfile:///b', title: 'x' }])).toThrow('invalid URL')
})
test('playlist decoding is strict and rejects binary, streaming manifests and oversized entry lists', () => {
  expect(decodePlaylist(new Uint8Array([0xff, 0xfe, 0x61, 0, 0x0a, 0]))).toBe('a\n')
  expect(() => decodePlaylist(new Uint8Array([0xc0, 0xaf]))).toThrow('UTF-8')
  expect(() =>
    parsePlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:6\nsong.ts', 'x.m3u8', 'https://music.test'),
  ).toThrow('HLS')
  expect(() => parsePlaylist('song.mp3\n'.repeat(10001), 'x.m3u', 'https://music.test')).toThrow(
    '10,000',
  )
  expect(() => parsePlaylist('#EXTM3U\n', 'x.m3u', 'https://music.test')).toThrow('no file entries')
  const name = playlistFilename('😃'.repeat(200) + '/test')
  expect(new TextEncoder().encode(name).length).toBeLessThan(200)
  expect(name.endsWith('.m3u8')).toBe(true)
  expect(name).not.toContain('/')
})
