import { describe, expect, spyOn, test } from 'bun:test'
import { createHermesSession, HermesSessions } from '@/features/hermes/hermes-session-store'

describe('Hermes session identity', () => {
  test('keeps one mutable authority when a draft becomes durable and the id rotates', () => {
    const suffix = crypto.randomUUID()
    const firstSessionId = `durable-${suffix}`
    const rotatedSessionId = `rotated-${suffix}`
    const session = HermesSessions.open({ draftId: `draft-${suffix}` })
    const stableKey = session.key()
    session.composer.setDraft('shared draft')

    session.identity.bind(firstSessionId)
    session.identity.bind(rotatedSessionId)

    const first = HermesSessions.open({ sessionId: firstSessionId })
    const rotated = HermesSessions.open({ sessionId: rotatedSessionId })
    expect(first.key()).toBe(stableKey)
    expect(rotated.key()).toBe(stableKey)
    expect(HermesSessions.forId(firstSessionId)).toBe(session.state())
    expect(HermesSessions.forId(rotatedSessionId)).toBe(session.state())
    expect(HermesSessions.forId(rotatedSessionId)?.composer).toBe('shared draft')
  })
})

test('opening an identified Hermes session does not need secure-context UUID generation', () => {
  const randomUUID = spyOn(crypto, 'randomUUID').mockImplementation(() => {
    throw new Error('randomUUID is unavailable')
  })
  try {
    for (const target of [{ sessionId: 'identified-session' }, { draftId: 'identified-draft' }]) {
      const session = createHermesSession(target)
      expect(session.key()).toContain(target.sessionId ?? target.draftId!)
    }
    expect(randomUUID).not.toHaveBeenCalled()
  } finally {
    randomUUID.mockRestore()
  }
})

test('Hermes commands publish immutable snapshots shared by session aliases', () => {
  const session = HermesSessions.open({ draftId: `immutable-${crypto.randomUUID()}` })
  const before = session.state()!
  session.composer.setDraft('first prompt')
  const changed = session.state()!
  expect(before.composer).toBe('')
  expect(changed.composer).toBe('first prompt')
  expect(Object.isFrozen(changed)).toBe(true)
  expect(Object.isFrozen(changed.messages)).toBe(true)
  const id = `immutable-session-${crypto.randomUUID()}`
  session.identity.bind(id)
  const alias = HermesSessions.open({ sessionId: id })
  alias.composer.setDraft('updated from alias')
  expect(session.state()).toBe(alias.state())
  expect(changed.composer).toBe('first prompt')
})
