import { expect, test } from 'bun:test'
import {
  chapterAt,
  parsePlaybackTime,
  precisePlaybackTime,
} from '../../src/features/playback/video-navigation'
test('video time inputs accept seconds and precise clock times without ambiguous rollovers', () => {
  expect(['12', '1:02', '1:02:03.125', '0:00.5', ' 90.01 '].map(parsePlaybackTime)).toEqual([
    12, 62, 3723.125, 0.5, 90.01,
  ])
  for (const value of ['', '-1', '1:60', '0:60:00', '1e3', '1:2:3:4', 'NaN', '1:00.0001'])
    expect(parsePlaybackTime(value)).toBeNull()
  for (const value of [0, 0.125, 62, 3723.125, 90.01])
    expect(parsePlaybackTime(precisePlaybackTime(value))).toBe(value)
})
test('chapter position lookup handles gaps, exact boundaries and the last chapter', () => {
  const chapters = [{ start: 2 }, { start: 20 }, { start: 42 }]
  expect([0, 2, 19, 20, 99].map((time) => chapterAt(chapters, time))).toEqual([-1, 0, 0, 1, 2])
  expect(chapterAt([], 0)).toBe(-1)
})
