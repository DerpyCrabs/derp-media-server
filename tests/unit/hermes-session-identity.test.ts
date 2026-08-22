import { describe, expect, test } from 'bun:test'
import { createHermesSession, HermesSessions } from '@/features/hermes/hermes-session-store'

describe('Hermes session identity', () => {
  test('keeps one mutable authority when a draft becomes durable and the id rotates', () => {
    const suffix = crypto.randomUUID()
    const firstSessionId = `durable-${suffix}`
    const rotatedSessionId = `rotated-${suffix}`
    const session = createHermesSession(() => ({ draftId: `draft-${suffix}` }))
    const stableKey = session.key()
    session.composer.set('shared draft')

    session.identity.bind(firstSessionId)
    session.identity.bind(rotatedSessionId)

    const first = createHermesSession(() => ({ sessionId: firstSessionId }))
    const rotated = createHermesSession(() => ({ sessionId: rotatedSessionId }))
    expect(first.key()).toBe(stableKey)
    expect(rotated.key()).toBe(stableKey)
    expect(HermesSessions.forId(firstSessionId)).toBe(session.state())
    expect(HermesSessions.forId(rotatedSessionId)).toBe(session.state())
    expect(HermesSessions.forId(rotatedSessionId)?.composer).toBe('shared draft')
  })
})
