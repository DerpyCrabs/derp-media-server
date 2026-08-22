import { describe, expect, test } from 'bun:test'
import { isHermesOpenTarget } from '../../src/features/hermes/hermes-open-target'

describe('Hermes open target validation', () => {
  test('accepts complete session and draft targets', () => {
    expect(
      isHermesOpenTarget({
        provider: 'hermes',
        type: 'hermesSession',
        sessionId: 'session-1',
        readOnly: false,
      }),
    ).toBe(true)
    expect(
      isHermesOpenTarget({
        provider: 'hermes',
        type: 'hermesDraft',
        projectPath: null,
        readOnly: false,
      }),
    ).toBe(true)
  })

  test('rejects incomplete or contradictory targets', () => {
    expect(isHermesOpenTarget({ provider: 'hermes', type: 'hermesSession', readOnly: false })).toBe(
      false,
    )
    expect(
      isHermesOpenTarget({
        provider: 'hermes',
        type: 'hermesSession',
        sessionId: '   ',
        readOnly: false,
      }),
    ).toBe(false)
    expect(
      isHermesOpenTarget({
        provider: 'hermes',
        type: 'hermesSession',
        sessionId: 'session-1',
        projectPath: '/unexpected',
        readOnly: false,
      }),
    ).toBe(false)
    expect(
      isHermesOpenTarget({
        provider: 'hermes',
        type: 'hermesDraft',
        sessionId: 'session-1',
        readOnly: false,
      }),
    ).toBe(false)
    expect(
      isHermesOpenTarget({
        provider: 'hermes',
        type: 'hermesDraft',
        projectPath: 42,
        readOnly: false,
      }),
    ).toBe(false)
    expect(isHermesOpenTarget({ provider: 'hermes', type: 'hermesDraft', readOnly: 'false' })).toBe(
      false,
    )
  })
})
