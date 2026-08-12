import type { SpaceOrigin } from './space'
import type { SpacePresentation } from '@/src/lib/routes'

export const SPACE_PRESENTATION_STORAGE_PREFIX = 'derp-space-presentation-v1:'

export function parseStoredSpacePresentation(value: string | null): SpacePresentation | null {
  return value === 'focus' || value === 'tiled' || value === 'map' ? value : null
}

export function defaultSpacePresentation(input: {
  explicit?: SpacePresentation
  stored?: string | null
  narrow: boolean
  origin: SpaceOrigin
}): SpacePresentation {
  if (input.explicit) return input.explicit
  const stored = parseStoredSpacePresentation(input.stored ?? null)
  if (stored) return stored
  if (input.narrow) return 'focus'
  return input.origin === 'canvas' ? 'map' : 'tiled'
}

export function spacePresentationStorageKey(spaceId: string): string {
  return `${SPACE_PRESENTATION_STORAGE_PREFIX}${encodeURIComponent(spaceId)}`
}
