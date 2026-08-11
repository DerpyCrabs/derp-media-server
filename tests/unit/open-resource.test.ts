import { describe, expect, test } from 'bun:test'
import type { ResourceSummary } from '@/lib/resource'
import {
  createResourceOpener,
  executeOpenPlan,
  openResource,
  type OpenContext,
  type OpenIntent,
} from '@/src/lib/open-resource'
import type { ViewerDescriptor, ViewerRegistry } from '@/src/lib/viewer-registry'
import { grantOpenScope } from '@/src/lib/legacy-resource-adapter'

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

  test('keeps planning pure and executor imports after synchronous gesture effect', async () => {
    let loads = 0
    const order: string[] = []
    const viewer: ViewerDescriptor = {
      id: 'image-viewer',
      role: 'viewer',
      load: async () => {
        order.push('load')
        loads += 1
        return { ImageViewerDialog: true }
      },
    }
    const registry: ViewerRegistry = { lookup: () => viewer }
    const opener = createResourceOpener(registry)

    const plan = opener(resource(), 'default', context)
    expect(plan.kind).toBe('viewer')
    expect(loads).toBe(0)
    const result = executeOpenPlan(plan, () => {
      order.push('effect')
      return 'executed'
    })
    expect(result).toBe('executed')
    expect(loads).toBe(1)
    expect(order).toEqual(['effect', 'load'])
    await Promise.resolve()
  })

  test('covers every intent and surface with owner/Grant plan parity', () => {
    const surfaces = ['library', 'workspace', 'canvas', 'share'] as const
    const intents: OpenIntent[] = ['default', 'browse', 'view', 'read', 'play']
    const scopes = [{ kind: 'owner' } as const, grantOpenScope('matrix-secret')]
    const inputs = [
      resource({ kind: 'folder', presentation: 'browse', providerOperations: ['browse'] }),
      resource({ mimeType: 'video/mp4', presentation: 'video', providerOperations: ['stream'] }),
      resource({ mimeType: 'audio/mpeg', presentation: 'audio', providerOperations: ['read'] }),
      resource({ mimeType: 'image/png', presentation: 'image' }),
      resource({ mimeType: 'text/plain', presentation: 'text' }),
      resource({ mimeType: 'application/pdf', presentation: 'pdf' }),
      resource({ mimeType: 'application/epub+zip', presentation: 'book' }),
      resource({ mimeType: 'application/octet-stream', presentation: 'unsupported' }),
      resource({
        kind: 'conversation',
        presentation: 'conversation',
        mimeType: undefined,
        openTarget: { type: 'hermesSession', sessionId: 'session-1', readOnly: true },
      }),
    ]
    const expectedKinds = [
      ['browse', 'browse', 'browse', 'viewer', 'blocked'],
      ['playback', 'blocked', 'playback', 'blocked', 'playback'],
      ['playback', 'blocked', 'playback', 'blocked', 'playback'],
      ['viewer', 'blocked', 'viewer', 'blocked', 'blocked'],
      ['viewer', 'blocked', 'viewer', 'blocked', 'blocked'],
      ['viewer', 'blocked', 'viewer', 'viewer', 'blocked'],
      ['viewer', 'blocked', 'viewer', 'viewer', 'blocked'],
      ['viewer', 'blocked', 'viewer', 'blocked', 'blocked'],
      ['conversation', 'blocked', 'conversation', 'blocked', 'blocked'],
    ] as const

    for (const [inputIndex, input] of inputs.entries()) {
      for (const [intentIndex, intent] of intents.entries()) {
        const baseline = openResource(input, intent, {
          surface: 'library',
          scope: scopes[0],
          effectiveOperations: input.providerOperations,
        })
        expect(baseline.kind).toBe(expectedKinds[inputIndex]![intentIndex])
        for (const surface of surfaces) {
          for (const scope of scopes) {
            expect(
              openResource(input, intent, {
                surface,
                scope,
                effectiveOperations: input.providerOperations,
              }),
            ).toEqual(baseline)
          }
        }
      }
    }
  })

  test('intersects real Grant effective operations for every executable plan family', () => {
    const grant = grantOpenScope('grant-operations-secret')
    const cases = [
      [
        resource({ kind: 'folder', presentation: 'browse', providerOperations: ['browse'] }),
        'browse',
      ],
      [
        resource({
          presentation: 'video',
          mimeType: 'video/mp4',
          providerOperations: ['stream'],
        }),
        'stream',
      ],
      [resource({ presentation: 'image', mimeType: 'image/png' }), 'read'],
      [
        resource({
          kind: 'conversation',
          presentation: 'conversation',
          openTarget: { type: 'hermesSession', sessionId: 'session-1', readOnly: true },
        }),
        'read',
      ],
    ] as const

    for (const [input, operation] of cases) {
      const allowed = openResource(input, 'default', {
        surface: 'share',
        scope: grant,
        effectiveOperations: [operation],
      })
      expect(allowed.kind).not.toBe('blocked')
      expect(
        openResource(input, 'default', {
          surface: 'share',
          scope: grant,
          effectiveOperations: ['download'],
        }),
      ).toMatchObject({ kind: 'blocked', reason: 'operation-unavailable' })
    }
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
