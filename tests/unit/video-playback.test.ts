import { describe, expect, test } from 'bun:test'
import { parseSubtitles, subtitleText } from '@/features/playback/subtitles'
import { chooseCompatibility, preferredTrack } from '@/features/playback/video-source'
import type { VideoInfo, VideoTrack } from '@/features/playback/video-source'

const track = (id: string, language: string, codec = 'aac'): VideoTrack => ({
  id,
  index: Number(id),
  language,
  codec,
  title: '',
  default: false,
  supported: true,
})
const english = track('1', 'eng')
const japanese = track('2', 'jpn')
const info: VideoInfo = {
  fingerprint: 'source',
  duration: 120,
  container: 'matroska,webm',
  video: { codec_name: 'h264', width: 1920, height: 1080 },
  audio: [english, japanese],
  subtitles: [],
  allowVideoTranscoding: false,
}

describe('video compatibility and track preferences', () => {
  test('fixes only the unsupported stream and preserves supported MKVs', () => {
    expect(chooseCompatibility(info, english, 'original', true, true)).toBe('original')
    expect(chooseCompatibility(info, japanese, 'original', true, true)).toBe('remux')
    expect(
      chooseCompatibility(
        { ...info, audio: [english, { ...japanese, default: true }] },
        english,
        'original',
        true,
        true,
      ),
    ).toBe('remux')
    expect(chooseCompatibility(info, english, 'original', true, false)).toBe('audio')
    expect(chooseCompatibility(info, english, 'original', false, true)).toBe('video')
    expect(
      chooseCompatibility({ ...info, container: 'mpegts' }, english, 'original', true, true),
    ).toBe('remux')
    expect(chooseCompatibility(info, english, 'video', true, true)).toBe('video')
  })

  test('matches language aliases, honors per-file overrides and explicit subtitle off', () => {
    expect(preferredTrack([english, japanese], undefined, 'ja')).toBe(japanese)
    expect(preferredTrack([english, japanese], '1', 'ja')).toBe(english)
    expect(preferredTrack([english, japanese], null, 'ja')).toBeUndefined()
    expect(preferredTrack([english, japanese], 'removed', 'ja')).toBe(japanese)
    expect(preferredTrack([english, japanese], undefined, undefined, true)).toBe(english)
  })
})

test('subtitles handle overlaps, boundaries, identifiers and markup as text', () => {
  const cues = parseSubtitles(
    'WEBVTT\n\ncue-1\n00:00:01.000 --> 00:00:04.000 align:start\n<b>Hello &amp; welcome</b>\n\n00:02.000 --> 00:03.000\n<v Speaker>Second line</v>\n\nNOTE not a cue\n\n00:04.000 --> 00:06.000\n&lt;script&gt;plain text&lt;/script&gt;\n\ninvalid --> 99\nignored',
  )
  expect(subtitleText(cues, 0.99)).toBe('')
  expect(subtitleText(cues, 2.5)).toBe('Hello & welcome\nSecond line')
  expect(subtitleText(cues, 3)).toBe('Hello & welcome')
  expect(subtitleText(cues, 4)).toBe('<script>plain text</script>')
  expect(subtitleText(cues, 6)).toBe('')
})
