import { describe, expect, test } from 'bun:test'
import { resourceKey } from '@/lib/domain/resource'
import type { ContentInstance } from '@/src/features/content/contracts'
import { createContentRegistry } from '@/src/features/content/registry'
import { contentRuntimeIdentity, createContentRuntime } from '@/src/features/content/runtime'

function integrationInstance(id: string): ContentInstance {
  return {
    id,
    type: 'integration',
    integration: 'fixture',
    view: 'card',
    state: {},
  }
}

describe('content runtime', () => {
  test('keeps integration state replacements in one owner but separates resources', () => {
    expect(contentRuntimeIdentity(integrationInstance('one'))).toBe(
      contentRuntimeIdentity({
        id: 'one',
        type: 'integration',
        integration: 'fixture',
        view: 'card',
        state: { sessionId: 'durable' },
      }),
    )
    expect(
      contentRuntimeIdentity({
        id: 'one',
        type: 'resource',
        resource: resourceKey('fixture', 'first'),
        renderer: 'fixture.renderer',
      }),
    ).not.toBe(
      contentRuntimeIdentity({
        id: 'one',
        type: 'resource',
        resource: resourceKey('fixture', 'second'),
        renderer: 'fixture.renderer',
      }),
    )
  })

  test('loads a registered renderer lazily and caches one in-flight module', async () => {
    let loads = 0
    const registry = createContentRegistry([
      {
        id: 'fixture',
        content: [
          {
            id: 'fixture.renderer',
            rules: [{ type: 'presentation', value: 'fixture-card' }],
            matchesContent: (instance) =>
              instance.type === 'integration' && instance.integration === 'fixture',
            load: async () => {
              loads += 1
              return {
                kind: 'content' as const,
                mount: ({ instance }) => `mounted:${instance().id}`,
              }
            },
          },
        ],
      },
    ])
    const runtime = createContentRuntime(registry)
    const instance = integrationInstance('one')

    expect(runtime.resolve(instance)).toMatchObject({
      ok: true,
      renderer: { id: 'fixture.renderer' },
    })
    expect(loads).toBe(0)
    const [first, second] = await Promise.all([
      runtime.loadRenderer(instance),
      runtime.loadRenderer(instance),
    ])
    expect(first).toBe(second)
    expect(first).toMatchObject({ kind: 'content' })
    expect(loads).toBe(1)

    const mounted = await runtime.mount(instance, {
      replace: () => {},
      close: () => {},
      focus: () => {},
    })
    expect(mounted).toMatchObject({
      ok: true,
      instance,
      renderer: 'fixture.renderer',
    })
    if (!mounted.ok) throw new Error('expected mounted content')
    expect(mounted.render()).toBe('mounted:one')
  })

  test('keeps one mounted renderer reactive across same-renderer resource changes', async () => {
    const first: ContentInstance = {
      id: 'viewer-one',
      type: 'resource',
      resource: resourceKey('fixture', 'first'),
      renderer: 'fixture.renderer',
    }
    const second: ContentInstance = {
      ...first,
      resource: resourceKey('fixture', 'second'),
    }
    let current = first
    let mountedInstance: (() => ContentInstance) | undefined
    const runtime = createContentRuntime(
      createContentRegistry([
        {
          id: 'fixture',
          content: [
            {
              id: 'fixture.renderer',
              rules: [{ type: 'fallback' }],
              matchesContent: (instance) =>
                instance.type === 'resource' && instance.resource.provider === 'fixture',
              load: async () => ({
                kind: 'content' as const,
                mount: ({ instance }) => {
                  mountedInstance = instance
                  return 'mounted'
                },
              }),
            },
          ],
        },
      ]),
    )

    const mounted = await runtime.mount(() => current, { replace: () => {} })
    if (!mounted.ok) throw new Error('expected mounted content')
    mounted.render()
    expect(mountedInstance?.()).toEqual(first)

    current = second
    expect(mountedInstance?.()).toEqual(second)
  })

  test('returns recoverable failures for rejected or unregistered content', async () => {
    const runtime = createContentRuntime(
      createContentRegistry([
        {
          id: 'fixture',
          sanitizers: [
            {
              id: 'fixture.reject',
              sanitize: () => null,
            },
          ],
        },
      ]),
    )
    const instance = integrationInstance('one')

    expect(runtime.resolve(instance)).toEqual({
      ok: false,
      reason: 'Content rejected by sanitizer',
      recoverable: instance,
    })
    await expect(runtime.loadRenderer(instance)).rejects.toThrow('Content rejected by sanitizer')
  })

  test('keeps invalid lazy modules recoverable at the runtime boundary', async () => {
    const instance = integrationInstance('invalid')
    const runtime = createContentRuntime(
      createContentRegistry([
        {
          id: 'fixture',
          content: [
            {
              id: 'fixture.invalid',
              rules: [{ type: 'presentation', value: 'fixture-card' }],
              matchesContent: () => true,
              load: async () => ({ invalid: true }) as never,
            },
          ],
        },
      ]),
    )

    expect(
      await runtime.mount(instance, {
        replace: () => {},
        close: () => {},
        focus: () => {},
      }),
    ).toEqual({
      ok: false,
      reason: 'Renderer fixture.invalid returned an invalid module',
      recoverable: instance,
    })
  })

  test('runs integration lifecycle cleanup on release', async () => {
    const calls: string[] = []
    const instance = integrationInstance('release-failure')
    const runtime = createContentRuntime(
      createContentRegistry([
        {
          id: 'fixture',
          lifecycles: [
            {
              id: 'fixture.lifecycle',
              supports: () => true,
              dispose: () => {
                calls.push('lifecycle')
              },
            },
          ],
        },
      ]),
    )
    expect(await runtime.release(instance)).toBe(true)
    expect(calls).toEqual(['lifecycle'])
  })
})
