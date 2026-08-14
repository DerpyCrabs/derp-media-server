import { describe, expect, test } from 'bun:test'
import { resourceKey, type ResourceSummary } from '@/lib/domain/resource'
import { defineIntegrationModule, type ContentInstance } from '@/src/features/content/contracts'
import { createContentRegistry } from '@/src/features/content/registry'

const fixtureKey = resourceKey('fixture', 'item-1')

function resource(): ResourceSummary {
  return {
    key: fixtureKey,
    name: 'Fixture item',
    kind: 'fixture-card',
    presentation: 'fixture-card',
    capabilities: ['read', 'fixture.pin'],
  }
}

function fixtureModule(id = 'fixture') {
  return defineIntegrationModule({
    id,
    browse: {
      browse: async ({ location }) => ({
        schemaVersion: 1 as const,
        location,
        items: [resource()],
        total: 1,
      }),
    },
    actions: {
      list: (item) =>
        item.capabilities.includes('fixture.pin')
          ? [{ id: 'fixture.pin', label: 'Pin', capability: 'fixture.pin' }]
          : [],
      run: async () => {},
    },
    content: [
      {
        id: 'fixture.renderer',
        rules: [{ type: 'kind' as const, value: 'fixture-card' }],
        matchesContent: (instance: ContentInstance) =>
          instance.type === 'integration' &&
          instance.integration === id &&
          instance.view === 'card',
        load: async () => ({ kind: 'content' as const, mount: () => null }),
      },
    ],
    codecs: [
      {
        id: 'fixture.content',
        version: 2,
        supports: (instance: ContentInstance) =>
          instance.type === 'integration' && instance.integration === id,
        encode: (instance: ContentInstance) => instance,
        decode: (value: unknown) =>
          value && typeof value === 'object'
            ? { ok: true as const, instance: value as ContentInstance }
            : { ok: false as const, reason: 'bad fixture', recoverable: value },
      },
    ],
    sanitizers: [
      {
        id: 'fixture.sanitize',
        supports: (instance: ContentInstance) =>
          instance.type === 'integration' && instance.integration === id,
        sanitize: (instance: ContentInstance) => instance,
      },
    ],
    presentations: [
      {
        id: 'fixture.presentation',
        describe: (instance: ContentInstance) =>
          instance.type === 'integration' && instance.integration === id
            ? { title: 'Fixture', icon: 'fixture', preferredSize: { width: 480, height: 360 } }
            : null,
      },
    ],
  })
}

describe('content registry', () => {
  test('indexes provider contributions without a core provider union', async () => {
    const registry = createContentRegistry([fixtureModule()])
    const instance: ContentInstance = {
      id: 'instance-1',
      type: 'integration',
      integration: 'fixture',
      view: 'card',
      state: { selected: fixtureKey.id },
    }

    expect(registry.module('fixture')?.id).toBe('fixture')
    expect((await registry.browse(fixtureKey)?.browse({ location: fixtureKey }))?.total).toBe(1)
    expect(
      registry
        .actions(resource())
        ?.list(resource())
        .map((action) => action.id),
    ).toEqual(['fixture.pin'])
    expect(registry.renderer(instance)?.id).toBe('fixture.renderer')
    expect(registry.presentation(instance)).toEqual({
      title: 'Fixture',
      icon: 'fixture',
      preferredSize: { width: 480, height: 360 },
    })
    expect(registry.sanitize(instance)).toEqual(instance)
  })

  test('does not mount a renderer owned by another resource provider', () => {
    const registry = createContentRegistry([fixtureModule()])
    const foreign: ContentInstance = {
      id: 'foreign-resource',
      type: 'resource',
      resource: resourceKey('foreign', 'item-1'),
      renderer: 'fixture.renderer',
    }

    expect(registry.renderer(foreign)).toBeNull()
    expect(
      registry.rendererRegistry.resolve(
        {
          key: foreign.resource,
          name: 'Foreign fixture card',
          kind: 'fixture-card',
          capabilities: ['read'],
        },
        'view',
      ),
    ).toBeNull()
  })

  test('writes one versioned envelope and preserves unknown or corrupt input', () => {
    const registry = createContentRegistry([fixtureModule()])
    const instance: ContentInstance = {
      id: 'instance-1',
      type: 'integration',
      integration: 'fixture',
      view: 'card',
      state: { selected: fixtureKey.id },
    }
    const encoded = registry.encode(instance)

    expect(encoded).toEqual({
      schemaVersion: 1,
      codec: 'fixture.content',
      codecVersion: 2,
      payload: instance,
    })
    expect(registry.decode(encoded)).toEqual({ ok: true, instance })

    const unknown = { ...encoded, codec: 'missing.codec', payload: { future: true } }
    expect(registry.decode(unknown)).toEqual({
      ok: false,
      reason: 'Unknown content codec: missing.codec',
      recoverable: unknown,
    })
    expect(registry.decode({ malformed: true })).toEqual({
      ok: false,
      reason: 'Invalid persisted content envelope',
      recoverable: { malformed: true },
    })
  })

  test('rejects duplicate module and contribution ids', () => {
    expect(() => createContentRegistry([fixtureModule(), fixtureModule()])).toThrow(
      'Duplicate integration id: fixture',
    )
    const other = fixtureModule('other')
    expect(() => createContentRegistry([fixtureModule(), other])).toThrow(
      'Duplicate renderer id: fixture.renderer',
    )
  })

  test('rejects explicit foreign codecs and invalid decoded content', () => {
    const registry = createContentRegistry([fixtureModule()])
    const foreign: ContentInstance = {
      id: 'foreign-1',
      type: 'integration',
      integration: 'foreign',
      view: 'card',
      state: {},
    }
    expect(() => registry.encode(foreign, 'fixture.content')).toThrow(
      'Content codec fixture.content does not accept instance',
    )

    const invalidRegistry = createContentRegistry([
      defineIntegrationModule({
        id: 'invalid',
        codecs: [
          {
            id: 'invalid.content',
            version: 1,
            decode: () => ({ ok: true as const, instance: { malformed: true } as never }),
            encode: (instance) => instance,
          },
        ],
      }),
    ])
    const envelope = {
      schemaVersion: 1 as const,
      codec: 'invalid.content',
      codecVersion: 1,
      payload: {},
    }
    expect(invalidRegistry.decode(envelope)).toEqual({
      ok: false,
      reason: 'Content codec invalid.content returned invalid content',
      recoverable: envelope,
    })
  })

  test('rejects malformed or foreign content returned by a sanitizer', () => {
    const instance: ContentInstance = {
      id: 'instance-1',
      type: 'integration',
      integration: 'fixture',
      view: 'card',
      state: {},
    }
    for (const sanitized of [
      { malformed: true } as never,
      { ...instance, integration: 'foreign' } as ContentInstance,
    ]) {
      const module = fixtureModule()
      const registry = createContentRegistry([
        defineIntegrationModule({
          ...module,
          sanitizers: [
            {
              id: 'fixture.sanitize',
              supports: () => true,
              sanitize: () => sanitized,
            },
          ],
        }),
      ])
      const envelope = registry.encode(instance)

      expect(registry.sanitize(instance)).toBeNull()
      expect(registry.decode(envelope)).toEqual({
        ok: false,
        reason: 'Content codec fixture.content returned rejected content',
        recoverable: envelope,
      })
    }
  })
})
