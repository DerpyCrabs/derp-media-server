import { describe, expect, test } from 'bun:test'
import { snapshotName } from '../../src/features/playback/video-snapshot'
describe('snapshot names', () => {
  test('use absolute playback time and preserve the source folder', () => {
    expect(snapshotName('Videos/film.final.mp4', 3661.234)).toBe(
      'Videos/film.final-01-01-01.234.png',
    )
    expect(snapshotName('clip.webm', 59.9999)).toBe('clip-00-01-00.000.png')
    expect(snapshotName('clip.webm', -10)).toBe('clip-00-00-00.000.png')
  })
  test('truncate UTF-8 stems without splitting graphemes or exceeding file-name limits', () => {
    const stem = '👩‍💻'.repeat(50)
    const result = snapshotName(`Videos/${stem}.mp4`, 0).split('/').pop()!
    expect(new TextEncoder().encode(result).length).toBeLessThan(255)
    expect(result).toMatch(/^(👩‍💻)+-00-00-00\.000\.png$/)
  })
})
