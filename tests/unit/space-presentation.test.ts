import { describe, expect, test } from 'bun:test'
import {
  defaultSpacePresentation,
  parseStoredSpacePresentation,
  spacePresentationStorageKey,
} from '@/lib/space-presentation'

describe('Space presentation selection', () => {
  test('explicit route wins across devices', () => {
    expect(
      defaultSpacePresentation({
        explicit: 'map',
        stored: 'focus',
        narrow: true,
        origin: 'workspace',
      }),
    ).toBe('map')
  })

  test('bare route uses valid device preference', () => {
    expect(defaultSpacePresentation({ stored: 'tiled', narrow: true, origin: 'canvas' })).toBe(
      'tiled',
    )
  })

  test('bare route falls back to Focus on narrow screens and origin layout on desktop', () => {
    expect(defaultSpacePresentation({ narrow: true, origin: 'canvas' })).toBe('focus')
    expect(defaultSpacePresentation({ narrow: false, origin: 'canvas' })).toBe('map')
    expect(defaultSpacePresentation({ narrow: false, origin: 'workspace' })).toBe('tiled')
  })

  test('corrupt preference is ignored and keys are opaque-Space scoped', () => {
    expect(parseStoredSpacePresentation('grid')).toBeNull()
    expect(spacePresentationStorageKey('family/desk%phone')).toBe(
      'derp-space-presentation-v1:family%2Fdesk%25phone',
    )
  })
})
