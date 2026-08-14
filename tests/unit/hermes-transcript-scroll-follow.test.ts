import { describe, expect, test } from 'bun:test'
import { createTranscriptScrollFollow } from '@/src/integrations/hermes/transcript-scroll-follow'

describe('Hermes transcript scroll follow', () => {
  test('does not resume from a stale bottom event while user scrolls away', () => {
    const follow = createTranscriptScrollFollow()

    follow.stop(true)
    follow.observe(true)
    expect(follow.shouldFollow()).toBe(false)

    follow.observe(false)
    expect(follow.shouldFollow()).toBe(false)

    follow.observe(true)
    expect(follow.shouldFollow()).toBe(true)
  })

  test('explicit stop and resume control resize-driven following', () => {
    const follow = createTranscriptScrollFollow()

    follow.stop(false)
    expect(follow.shouldFollow()).toBe(false)

    follow.resume()
    expect(follow.shouldFollow()).toBe(true)
  })
})
