import { describe, expect, test } from 'bun:test'
import { resourceKey, type ResourceSummary } from '@/lib/domain/resource'
import {
  contentForOpenPlan,
  type OpenIntent,
  type OpenSurface,
} from '@/src/features/open/open-resource'
import {
  createRendererRegistry,
  type RendererDescriptor,
} from '@/src/features/open/renderer-registry'
import { FILESYSTEM_RENDERER_ID } from '@/src/integrations/filesystem/renderers'
import { createResourceOpener } from '@/src/features/open/open-resource'
import { openResource } from '@/src/integrations/open-resource'
import { HERMES_CHAT_RENDERER_ID, hermesResourceKey } from '@/src/integrations/hermes/module'

function resource(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    key: resourceKey('filesystem', 'opaque-resource'),
    name: 'item',
    kind: 'file',
    capabilities: ['read', 'stream', 'download'],
    presentation: 'image',
    mime: 'image/jpeg',
    ...overrides,
  }
}

describe('openResource', () => {
  test('plans every current kind and explicit intent identically across surfaces', () => {
    const cases: readonly [string, ResourceSummary, OpenIntent, string, string?][] = [
      [
        'folder default',
        resource({
          kind: 'folder',
          presentation: 'browse',
          mime: undefined,
          capabilities: ['browse'],
        }),
        'default',
        'browse',
      ],
      [
        'folder browse',
        resource({
          kind: 'folder',
          presentation: 'browse',
          mime: undefined,
          capabilities: ['browse'],
        }),
        'browse',
        'browse',
      ],
      [
        'folder read',
        resource({
          kind: 'folder',
          presentation: 'browse',
          mime: undefined,
          capabilities: ['browse'],
        }),
        'read',
        'render',
        FILESYSTEM_RENDERER_ID.folderReader,
      ],
      [
        'video play',
        resource({ presentation: 'video', mime: 'video/mp4' }),
        'play',
        'render',
        FILESYSTEM_RENDERER_ID.video,
      ],
      [
        'audio default',
        resource({ presentation: 'audio', mime: 'audio/mpeg' }),
        'default',
        'render',
        FILESYSTEM_RENDERER_ID.audio,
      ],
      ['image view', resource(), 'view', 'render', FILESYSTEM_RENDERER_ID.image],
      [
        'text default',
        resource({ presentation: 'text', mime: 'text/markdown' }),
        'default',
        'render',
        FILESYSTEM_RENDERER_ID.text,
      ],
      [
        'pdf read',
        resource({ presentation: 'pdf', mime: 'application/pdf' }),
        'read',
        'render',
        FILESYSTEM_RENDERER_ID.pdf,
      ],
      [
        'book read',
        resource({ presentation: 'book', mime: 'application/epub+zip' }),
        'read',
        'render',
        FILESYSTEM_RENDERER_ID.book,
      ],
      [
        'other default',
        resource({ presentation: 'unsupported', mime: 'application/octet-stream' }),
        'default',
        'render',
        FILESYSTEM_RENDERER_ID.unsupported,
      ],
    ]
    const surfaces: readonly OpenSurface[] = ['library', 'workspace', 'canvas']

    for (const [label, input, intent, kind, renderer] of cases) {
      const plans = surfaces.map((surface) =>
        openResource(input, intent, { surface, disposition: 'window' }),
      )
      expect(plans, label).toEqual([plans[0], plans[0], plans[0]])
      expect(plans[0], label).toMatchObject({ status: 'ready', kind })
      if (renderer) expect(plans[0], label).toMatchObject({ renderer })
    }
  })

  test('passes host-selected placement through without route or geometry effects', () => {
    const plans = [
      openResource(resource(), 'default', { surface: 'library', disposition: 'modal' }),
      openResource(resource(), 'default', { surface: 'workspace', disposition: 'pane' }),
      openResource(resource(), 'default', { surface: 'canvas', disposition: 'window' }),
    ]

    expect(plans.map((plan) => (plan.status === 'ready' ? plan.disposition : null))).toEqual([
      'modal',
      'pane',
      'window',
    ])
    expect(
      plans.map((plan) => {
        if (plan.status !== 'ready') return plan
        const { disposition: _disposition, ...semantic } = plan
        return semantic
      }),
    ).toEqual([
      {
        status: 'ready',
        kind: 'render',
        summary: resource(),
        renderer: FILESYSTEM_RENDERER_ID.image,
        intent: 'default',
      },
      {
        status: 'ready',
        kind: 'render',
        summary: resource(),
        renderer: FILESYSTEM_RENDERER_ID.image,
        intent: 'default',
      },
      {
        status: 'ready',
        kind: 'render',
        summary: resource(),
        renderer: FILESYSTEM_RENDERER_ID.image,
        intent: 'default',
      },
    ])
  })

  test('creates durable host content from one complete ready plan', () => {
    const input = resource()
    const plan = openResource(input, 'view', {
      surface: 'canvas',
      disposition: 'window',
    })
    if (plan.status !== 'ready') throw new Error('Expected ready plan')

    expect(plan.summary).toEqual(input)
    expect(contentForOpenPlan(plan, 'content-1', resourceKey('filesystem', 'context'))).toEqual({
      id: 'content-1',
      type: 'resource',
      resource: input.key,
      renderer: FILESYSTEM_RENDERER_ID.image,
      context: resourceKey('filesystem', 'context'),
    })
  })

  test('returns typed blocked plans for incompatible intent and missing capability', () => {
    expect(
      openResource(resource(), 'play', { surface: 'library', disposition: 'fullscreen' }),
    ).toMatchObject({ status: 'blocked', reason: 'incompatible-intent' })
    expect(
      openResource(resource({ capabilities: ['download'] }), 'default', {
        surface: 'library',
        disposition: 'modal',
      }),
    ).toMatchObject({
      status: 'blocked',
      reason: 'capability-unavailable',
      requiredCapabilities: ['read'],
    })
  })

  test('planning never loads renderer and never infers provider behavior from paths', async () => {
    let loads = 0
    const descriptor: RendererDescriptor = {
      id: 'fixture-renderer',
      rules: [{ type: 'presentation', value: 'fixture-card', intents: ['default'] }],
      requiresAnyCapability: ['fixture.open'],
      load: async () => {
        loads += 1
        return { kind: 'content', mount: () => null }
      },
    }
    const registry = createRendererRegistry([descriptor])
    const opener = createResourceOpener(registry)
    const input = resource({
      key: resourceKey('fixture', 'looks/like/video.mp4'),
      name: 'video.mp4',
      mime: undefined,
      presentation: 'fixture-card',
      capabilities: ['fixture.open'],
    })

    expect(opener(input, 'default', { surface: 'workspace', disposition: 'pane' })).toMatchObject({
      status: 'ready',
      renderer: 'fixture-renderer',
    })
    expect(loads).toBe(0)
    await registry.load('fixture-renderer')
    expect(loads).toBe(1)
  })

  test('uses the assembled integration registry for Hermes without surface branches', () => {
    const input = resource({
      key: hermesResourceKey('session', 'opaque-session'),
      name: 'Hermes session',
      kind: 'hermes-session',
      mime: undefined,
      presentation: 'hermes-session',
      capabilities: ['read'],
    })
    const plans = (['library', 'workspace', 'canvas'] as const).map((surface) =>
      openResource(input, 'default', { surface, disposition: 'window' }),
    )

    expect(plans).toEqual([plans[0], plans[0], plans[0]])
    expect(plans[0]).toMatchObject({
      status: 'ready',
      kind: 'render',
      renderer: HERMES_CHAT_RENDERER_ID,
    })
    for (const surface of ['library', 'workspace', 'canvas'] as const) {
      expect(openResource(input, 'read', { surface, disposition: 'window' })).toMatchObject({
        status: 'blocked',
        reason: 'incompatible-intent',
      })
    }
  })
})
