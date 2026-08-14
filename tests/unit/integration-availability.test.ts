import { describe, expect, test } from 'bun:test'
import type { IntegrationDescriptorDto } from '@/lib/generated/api-contracts'
import { resourceKey, type ResourceSummary } from '@/lib/domain/resource'
import { createIntegrationAvailability } from '@/src/integrations/availability'
import { integrationDescriptorsQueryOptions } from '@/src/integrations/query-options'
import { defineIntegrationModule } from '@/src/features/content/contracts'
import { createContentRegistry } from '@/src/features/content/registry'
import { createApplicationSearchCoordinator } from '@/src/integrations/search'

function descriptor(
  id: string,
  capabilities: IntegrationDescriptorDto['capabilities'],
): IntegrationDescriptorDto {
  return {
    id,
    name: id,
    capabilities,
    root: {
      key: { provider: id, id: `${id}-root` },
      name: `${id} server root`,
      kind: 'root',
      capabilities: ['browse'],
    },
  }
}

describe('integration availability', () => {
  test('uses the SSR-shared integration descriptor query key', () => {
    expect(integrationDescriptorsQueryOptions().queryKey[0]).toBe('integrations')
  })

  test('gates capabilities from server descriptors while preserving a startup root', () => {
    const availability = createIntegrationAvailability(['filesystem'])
    const staticRoot: ResourceSummary = {
      key: resourceKey('filesystem', 'static-root'),
      name: 'Static root',
      kind: 'root',
      capabilities: ['browse'],
    }
    let changes = 0
    const unsubscribe = availability.subscribe(() => changes++)

    expect(availability.root('filesystem', staticRoot)).toEqual(staticRoot)
    expect(availability.isEnabled('hermes', 'browse')).toBe(false)

    availability.replace([descriptor('filesystem', ['browse', 'inspect', 'actions', 'search'])])
    expect(availability.root('filesystem', staticRoot)?.name).toBe('filesystem server root')
    expect(availability.isEnabled('filesystem', 'actions')).toBe(true)
    expect(changes).toBe(1)

    availability.replace([
      descriptor('filesystem', ['browse', 'inspect', 'actions', 'search']),
      descriptor('hermes', ['browse']),
    ])
    expect(availability.isEnabled('hermes')).toBe(true)
    expect(availability.isEnabled('hermes', 'actions')).toBe(false)
    expect(availability.root('hermes', undefined)?.key).toEqual({
      provider: 'hermes',
      id: 'hermes-root',
    })
    expect(changes).toBe(2)

    unsubscribe()
  })

  test('refreshes application search contributors after availability replacement', () => {
    const availability = createIntegrationAvailability(['filesystem'])
    const searchModule = (id: string) =>
      defineIntegrationModule({
        id,
        search: [
          {
            id: `${id}.search`,
            label: id,
            search: async () => ({ results: [] }),
          },
        ],
      })
    const registry = createContentRegistry([searchModule('filesystem'), searchModule('hermes')], {
      enabled: availability.isEnabled,
    })
    const coordinator = createApplicationSearchCoordinator(registry)

    availability.replace([descriptor('filesystem', ['search'])])
    expect(coordinator.contributors.map((contributor) => contributor.id)).toEqual([
      'server.integrations',
      'filesystem.search',
    ])

    availability.replace([descriptor('filesystem', ['search']), descriptor('hermes', ['search'])])
    expect(coordinator.contributors.map((contributor) => contributor.id)).toEqual([
      'server.integrations',
      'filesystem.search',
      'hermes.search',
    ])
  })
})
