import { describe, expect, test } from 'bun:test'
import { resourceKey, type ResourcePage, type ResourceSummary } from '@/lib/domain/resource'
import {
  defineIntegrationModule,
  isContentInstance,
  type CanvasHost,
  type ContentCodecDescriptor,
  type ContentInstance,
  type LibraryHost,
  type WorkspaceHost,
} from '@/src/features/content/contracts'
import type { OpenReadyPlan } from '@/src/features/open/open-resource'

const key = resourceKey('fixture', 'opaque-item')

describe('content and integration contracts', () => {
  test('accepts neutral content instances and rejects geometry-shaped payloads', () => {
    const instances: ContentInstance[] = [
      { id: 'explorer-1', type: 'explorer', location: key },
      { id: 'resource-1', type: 'resource', resource: key, renderer: 'fixture-renderer' },
      {
        id: 'integration-1',
        type: 'integration',
        integration: 'fixture',
        view: 'card',
        state: { selected: 'opaque-item' },
      },
    ]
    for (const instance of instances) expect(isContentInstance(instance)).toBe(true)

    expect(
      isContentInstance({
        id: 'bad',
        type: 'resource',
        resource: key,
        renderer: 'fixture-renderer',
        x: 10,
      }),
    ).toBe(false)
  })

  test('codec failures retain recoverable input', () => {
    const codec: ContentCodecDescriptor = {
      id: 'fixture-codec',
      version: 1,
      encode: (instance) => instance,
      decode: (value) =>
        isContentInstance(value)
          ? { ok: true, instance: value }
          : { ok: false, reason: 'invalid fixture content', recoverable: value },
    }
    const malformed = { old: 'payload' }

    expect(codec.decode(malformed)).toEqual({
      ok: false,
      reason: 'invalid fixture content',
      recoverable: malformed,
    })
  })

  test('defines compile-time integration contributions without core provider unions', async () => {
    const item: ResourceSummary = {
      key,
      name: 'Fixture item',
      kind: 'fixture-card',
      capabilities: ['read', 'fixture.pin'],
      presentation: 'fixture-card',
    }
    const page: ResourcePage = {
      schemaVersion: 1,
      location: resourceKey('fixture', 'root'),
      items: [item],
      total: 1,
    }
    const module = defineIntegrationModule({
      id: 'fixture',
      browse: { browse: async (_request) => page },
      search: {
        search: async (_request) => ({ items: [item], total: 1 }),
      },
      actions: {
        list: (_resource) => [{ id: 'fixture.pin', label: 'Pin', capability: 'fixture.pin' }],
        run: async (_request) => {},
      },
      content: [
        {
          id: 'fixture-renderer',
          rules: [{ type: 'kind', value: 'fixture-card' }],
          load: async () => ({ render: true }),
        },
      ],
      codecs: [],
      sanitizers: [],
    })

    expect(module.id).toBe('fixture')
    expect((await module.browse?.browse({ location: page.location })).items[0]).toEqual(item)
    expect(module.actions?.list(item)[0].id).toBe('fixture.pin')
  })

  test('host contracts contain placement commands but no geometry', () => {
    const calls: OpenReadyPlan[] = []
    const common = {
      close: (_instanceId: string) => {},
      focus: (_instanceId: string) => {},
    }
    const library: LibraryHost = {
      surface: 'library',
      ...common,
      open: (plan) => calls.push(plan),
    }
    const workspace: WorkspaceHost = {
      surface: 'workspace',
      ...common,
      open: (plan) => calls.push(plan),
    }
    const canvas: CanvasHost = {
      surface: 'canvas',
      ...common,
      open: (plan) => calls.push(plan),
    }

    expect([library.surface, workspace.surface, canvas.surface]).toEqual([
      'library',
      'workspace',
      'canvas',
    ])
    expect(Object.keys(canvas).sort()).toEqual(['close', 'focus', 'open', 'surface'])
  })
})
