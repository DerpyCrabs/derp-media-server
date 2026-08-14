import { describe, expect, test } from 'bun:test'
import {
  hermesResourceAddress,
  hermesResourceKey,
  requireHermesOpaqueId,
} from '@/src/integrations/hermes/resource-key'

describe('Hermes ResourceKey contract', () => {
  test('accepts same opaque identifiers as server boundary', () => {
    for (const id of [
      ' ',
      'opaque?query#fragment',
      'a'.repeat(512),
      'é'.repeat(256),
      '😀'.repeat(128),
    ]) {
      expect(requireHermesOpaqueId(id)).toBe(id)
      expect(hermesResourceAddress(hermesResourceKey('session', id))).toEqual({
        kind: 'session',
        id,
      })
    }
  })

  test('rejects server-reserved identifiers and UTF-8 payloads over 512 bytes', () => {
    for (const id of [
      '',
      '.',
      '..',
      '../config',
      String.raw`a\b`,
      'a%2fb',
      'a\nb',
      `a${String.fromCharCode(0x85)}b`,
      'a'.repeat(513),
      'é'.repeat(257),
      '😀'.repeat(129),
    ]) {
      expect(() => requireHermesOpaqueId(id)).toThrow()
      expect(() => hermesResourceKey('session', id)).toThrow()
    }
  })
})
