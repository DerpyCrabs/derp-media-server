import { describe, expect, test } from 'bun:test'
import type { ResourceSummary } from '@/lib/resource'
import { createResourceOpener, openResource, type OpenContext } from '@/src/lib/open-resource'
import type { ViewerDescriptor, ViewerRegistry } from '@/src/lib/viewer-registry'

const context: OpenContext = { surface: 'library', scope: { kind: 'owner' } }

function resource(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    ref: { libraryId: 'library-1', resourceId: 'resource-1' },
    locator: { sourceId: 'source-1', providerLocator: 'item' },
    legacyLocator: 'item',
    version: 'opaque-v1',
    name: 'item',
    kind: 'file',
    presentation: 'image',
    mimeType: 'image/jpeg',
    providerOperations: ['read', 'download'],
    availability: 'present',
    ...overrides,
  }
}

describe('openResource', () => {
  test('plans every built-in semantic target', () => {
    const cases = [
      [
        resource({ kind: 'folder', presentation: 'browse', providerOperations: ['browse'] }),
        'browse',
        undefined,
      ],
      [
        resource({ presentation: 'video', mimeType: 'video/mp4', providerOperations: ['stream'] }),
        'playback',
        'video-player',
      ],
      [
        resource({ presentation: 'audio', mimeType: 'audio/mpeg', providerOperations: ['read'] }),
        'playback',
        'audio-player',
      ],
      [resource(), 'viewer', 'image-viewer'],
      [
        resource({
          kind: 'conversation',
          presentation: 'conversation',
          mimeType: undefined,
          openTarget: { type: 'hermesSession', sessionId: 'session-1', readOnly: true },
        }),
        'conversation',
        'conversation',
      ],
      [
        resource({ presentation: 'unsupported', mimeType: 'application/octet-stream' }),
        'viewer',
        'unsupported-file',
      ],
    ] as const

    for (const [input, kind, viewerId] of cases) {
      const plan = openResource(input, 'default', context)
      expect(plan.kind).toBe(kind)
      if (viewerId && 'viewer' in plan) expect(plan.viewer.id).toBe(viewerId)
    }
  })

  test('uses explicit intents without executing caller effects', () => {
    const folder = resource({
      kind: 'folder',
      presentation: 'browse',
      mimeType: undefined,
      providerOperations: ['browse'],
    })
    expect(openResource(folder, 'browse', context).kind).toBe('browse')
    const reader = openResource(folder, 'read', context)
    expect(reader.kind).toBe('viewer')
    if (reader.kind === 'viewer') expect(reader.viewer.id).toBe('folder-reader')

    expect(openResource(resource(), 'play', context)).toMatchObject({
      kind: 'blocked',
      reason: 'incompatible-intent',
    })
    expect(openResource(folder, 'view', context).kind).toBe('browse')
  })

  test('returns typed unavailable and intrinsic-operation plans', () => {
    expect(openResource(resource({ availability: 'missing' }), 'default', context)).toMatchObject({
      kind: 'blocked',
      reason: 'resource-missing',
    })
    expect(
      openResource(resource({ availability: 'sourceUnavailable' }), 'default', context),
    ).toMatchObject({ kind: 'blocked', reason: 'source-unavailable' })
    expect(
      openResource(resource({ providerOperations: ['download'] }), 'default', context),
    ).toMatchObject({
      kind: 'blocked',
      reason: 'operation-unavailable',
      requiredOperations: ['read'],
    })
  })

  test('honors effective operations and presentation constraints', () => {
    expect(
      openResource(resource(), 'default', {
        ...context,
        effectiveOperations: ['download'],
      }),
    ).toMatchObject({
      kind: 'blocked',
      reason: 'operation-unavailable',
      requiredOperations: ['read'],
    })
    expect(
      openResource(
        resource({
          presentation: 'video',
          mimeType: 'video/mp4',
          providerOperations: ['stream'],
        }),
        'play',
        { ...context, presentationConstraints: { allowPlayback: false } },
      ),
    ).toMatchObject({ kind: 'blocked', reason: 'presentation-constrained' })
    expect(
      openResource(resource(), 'default', {
        ...context,
        presentationConstraints: { allowedViewerIds: ['text-viewer'] },
      }),
    ).toMatchObject({ kind: 'blocked', reason: 'presentation-constrained' })
    expect(
      openResource(
        resource({
          kind: 'conversation',
          presentation: 'conversation',
          openTarget: { type: 'hermesSession', sessionId: 'session-1', readOnly: true },
        }),
        'default',
        { ...context, presentationConstraints: { allowConversation: false } },
      ),
    ).toMatchObject({ kind: 'blocked', reason: 'presentation-constrained' })
  })

  test('requires a provider target for conversations', () => {
    expect(
      openResource(
        resource({
          kind: 'conversation',
          presentation: 'conversation',
          mimeType: undefined,
        }),
        'default',
        context,
      ),
    ).toMatchObject({ kind: 'blocked', reason: 'missing-open-target' })
  })

  test('produces identical plans for every current surface', () => {
    const input = resource()
    const surfaces = ['library', 'workspace', 'canvas', 'share'] as const
    const plans = surfaces.map((surface) =>
      openResource(input, 'default', { surface, scope: { kind: 'owner' } }),
    )
    for (const plan of plans.slice(1)) expect(plan).toEqual(plans[0])
  })

  test('does not invoke lazy viewer factory while planning', async () => {
    let loads = 0
    const viewer: ViewerDescriptor = {
      id: 'image-viewer',
      role: 'viewer',
      load: async () => {
        loads += 1
        return { ImageViewerDialog: true }
      },
    }
    const registry: ViewerRegistry = { lookup: () => viewer }
    const opener = createResourceOpener(registry)

    const plan = opener(resource(), 'default', context)
    expect(plan.kind).toBe('viewer')
    expect(loads).toBe(0)
    if (plan.kind === 'viewer') await plan.viewer.load()
    expect(loads).toBe(1)
  })

  test('never infers presentation from locator or name', () => {
    const plan = openResource(
      resource({
        name: 'ambiguous.ogg',
        locator: { sourceId: 'source-1', providerLocator: 'ambiguous.ogg' },
        legacyLocator: 'ambiguous.ogg',
        presentation: 'unsupported',
        mimeType: undefined,
      }),
      'default',
      context,
    )
    expect(plan.kind).toBe('viewer')
    if (plan.kind === 'viewer') expect(plan.viewer.id).toBe('unsupported-file')
  })
})
