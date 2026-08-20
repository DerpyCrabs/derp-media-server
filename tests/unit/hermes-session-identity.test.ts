import { describe, expect, test } from 'bun:test'
import {
  bindHermesSessionId,
  ensureHermesChat,
  hermesSessionForId,
  hermesSessions,
} from '@/features/hermes/hermes-session-store'

describe('Hermes session identity', () => {
  test('keeps one mutable authority when a draft becomes durable and the id rotates', () => {
    const suffix = crypto.randomUUID()
    const firstSessionId = `durable-${suffix}`
    const rotatedSessionId = `rotated-${suffix}`
    const stableKey = ensureHermesChat({ draftId: `draft-${suffix}` })
    hermesSessions[stableKey]!.composer = 'shared draft'

    bindHermesSessionId(stableKey, firstSessionId)
    bindHermesSessionId(stableKey, rotatedSessionId)

    expect(ensureHermesChat({ sessionId: firstSessionId })).toBe(stableKey)
    expect(ensureHermesChat({ sessionId: rotatedSessionId })).toBe(stableKey)
    expect(hermesSessionForId(firstSessionId)).toBe(hermesSessions[stableKey])
    expect(hermesSessionForId(rotatedSessionId)).toBe(hermesSessions[stableKey])
    expect(hermesSessionForId(rotatedSessionId)?.composer).toBe('shared draft')
    expect(hermesSessions[`session:${rotatedSessionId}`]).toBeUndefined()
  })
})
