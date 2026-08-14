import { describe, expect, test } from 'bun:test'
import { filesystemResourceKey } from '@/lib/domain/resource'
import { createSearchCoordinator } from '@/src/features/search/coordinator'
import { executeSearchHit } from '@/src/features/search/executor'
import { createResourceOpener } from '@/src/features/open/open-resource'
import { createRendererRegistry } from '@/src/features/open/renderer-registry'
import { searchContributorResponseFromDto } from '@/src/integrations/http-client'

describe('search coordinator', () => {
  test('normalizes, ranks, deduplicates, limits, and isolates contributor failures', async () => {
    const duplicate = {
      id: 'notes',
      title: 'Nótes',
      resource: {
        key: filesystemResourceKey('media', 'Notes'),
        name: 'Notes',
        kind: 'folder',
        capabilities: ['browse'],
        presentation: 'browse',
      },
    }
    const coordinator = createSearchCoordinator([
      {
        id: 'filesystem.filename',
        label: 'Library',
        search: async () => ({
          results: [
            { ...duplicate, score: 5 },
            { id: 'nested', title: 'Old notes', detail: 'Archive', score: 1 },
          ],
        }),
      },
      {
        id: 'filesystem.knowledge',
        label: 'Knowledge',
        search: async () => ({ results: [{ ...duplicate, id: 'duplicate', score: 1 }] }),
      },
      {
        id: 'fixture.failed',
        label: 'Broken',
        search: async () => {
          throw new Error('fixture unavailable')
        },
      },
    ])

    const response = await coordinator.search({ query: 'notes', limit: 1 })

    expect(response.results).toHaveLength(1)
    expect(response.results[0]?.id).toBe('notes')
    expect(response.truncated).toBe(true)
    expect(response.contributors).toContainEqual({
      contributorId: 'fixture.failed',
      status: 'error',
      message: 'fixture unavailable',
    })
  })

  test('executes resource results through one OpenPlan path', async () => {
    const coordinator = createSearchCoordinator([])
    const resource = {
      key: filesystemResourceKey('media', 'Notes'),
      name: 'Notes',
      kind: 'folder',
      capabilities: ['browse'],
      presentation: 'browse',
    }
    const hit = {
      id: 'notes',
      contributorId: 'filesystem.filename',
      contributorLabel: 'Library',
      title: 'Notes',
      resource,
    }
    const placed: unknown[] = []
    const outcome = await executeSearchHit(coordinator, hit, {
      opener: createResourceOpener(createRendererRegistry([])),
      context: { surface: 'canvas', disposition: 'window' },
      place: (_hit, plan) => {
        placed.push(plan)
      },
    })

    expect(outcome).toBe('placed')
    expect(placed).toEqual([
      expect.objectContaining({ status: 'ready', kind: 'browse', disposition: 'window' }),
    ])
  })

  test('keeps typed server failures beside partial results', async () => {
    const response = searchContributorResponseFromDto({
      schemaVersion: 1,
      truncated: false,
      results: [
        {
          id: 'filesystem:item',
          contributor: 'filesystem',
          resource: {
            key: filesystemResourceKey('media', 'Notes'),
            name: 'Notes',
            kind: 'folder',
            capabilities: ['browse'],
          },
          title: 'Notes',
          score: 1,
        },
      ],
      failures: [{ contributor: 'hermes', message: 'Hermes unavailable' }],
    })
    const coordinator = createSearchCoordinator([
      { id: 'server.integrations', label: 'Library', search: async () => response },
    ])

    const result = await coordinator.search({ query: 'notes', limit: 10 })

    expect(result.results.map((item) => item.id)).toEqual(['filesystem:item'])
    expect(result.contributors).toEqual([
      { contributorId: 'server.integrations', status: 'ready' },
      { contributorId: 'hermes', status: 'error', message: 'Hermes unavailable' },
    ])
  })

  test('rejects duplicate contributor ids', () => {
    const contributor = { id: 'fixture', label: 'Fixture', search: async () => ({ results: [] }) }
    expect(() => createSearchCoordinator([contributor, contributor])).toThrow(
      'Duplicate search contributor id: fixture',
    )
  })

  test('forwards cancellation to every contributor', async () => {
    let canceled = false
    const coordinator = createSearchCoordinator([
      {
        id: 'fixture',
        label: 'Fixture',
        search(request) {
          return new Promise<{ results: [] }>((_, reject) => {
            request.signal?.addEventListener('abort', () => {
              canceled = true
              reject(new DOMException('Canceled', 'AbortError'))
            })
          })
        },
      },
    ])
    const abort = new AbortController()
    const result = coordinator.search({ query: 'fixture', limit: 10, signal: abort.signal })

    abort.abort()

    expect(canceled).toBe(true)
    expect(await result).toMatchObject({
      results: [],
      contributors: [{ contributorId: 'fixture', status: 'error' }],
    })
  })
})
