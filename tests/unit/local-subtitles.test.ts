import { expect, test } from 'bun:test'
import { decodeSubtitleFile, MAX_SUBTITLE_BYTES } from '../../src/features/playback/local-subtitles'
import { subtitleText, type SubtitleCue } from '../../src/features/playback/subtitles'
const srt = '1\r\n00:00:01,000 --> 00:00:04,000\r\nПривет &amp; hello\r\n'
test('local subtitles decode UTF-8 and BOM-marked UTF-16 without uploading or guessing encodings', () => {
  const expected = [{ start: 1, end: 4, text: 'Привет & hello' }]
  expect(decodeSubtitleFile(new TextEncoder().encode(srt), 'captions.SRT')).toEqual(expected)
  expect(
    decodeSubtitleFile(new Uint8Array(Buffer.from('\ufeff' + srt, 'utf16le')), 'captions.srt'),
  ).toEqual(expected)
  const little = Buffer.from('\ufeff' + srt, 'utf16le')
  expect(decodeSubtitleFile(new Uint8Array(little.swap16()), 'captions.srt')).toEqual(expected)
  expect(() => decodeSubtitleFile(new Uint8Array([0xff, 0x80]), 'bad.srt')).toThrow('encoding')
  expect(() => decodeSubtitleFile(new TextEncoder().encode(srt), 'bad.exe')).toThrow('SRT')
  expect(() => decodeSubtitleFile(new Uint8Array(MAX_SUBTITLE_BYTES + 1), 'big.srt')).toThrow(
    '4 MiB',
  )
  expect(() => decodeSubtitleFile(new TextEncoder().encode('No timestamps'), 'empty.vtt')).toThrow(
    'No readable',
  )
})
test('indexed subtitle lookups retain overlapping cues and work when seeking backwards', () => {
  const cues: SubtitleCue[] = Array.from({ length: 10000 }, (_, index) => ({
    start: index * 2,
    end: index * 2 + (index % 101 === 0 ? 600 : 3),
    text: `Line ${index}`,
  }))
  for (const position of [19998, 20001, 2, 15340.5, 800, 0, -1, 87, 14000])
    expect(subtitleText(cues, position)).toBe(
      cues
        .filter((cue) => cue.start <= position && cue.end > position)
        .map((cue) => cue.text)
        .join('\n'),
    )
  expect(subtitleText(cues, Number.NaN)).toBe('')
})
