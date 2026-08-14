import { describe, expect, test } from 'bun:test'
import type { ResourceSummaryDto } from '@/lib/generated/api-contracts'
import {
  resourceSummaryFromDto,
  serverIntegrationSearchContributor,
} from '@/src/integrations/http-client'

describe('integration HTTP resource mapping', () => {
  test('keeps appearance typed and separate from provider metadata', () => {
    const dto: ResourceSummaryDto = {
      key: { provider: 'fixture', id: 'card-1' },
      name: 'Fixture card',
      kind: 'fixture-card',
      capabilities: ['read'],
      appearance: { icon: 'Archive', tone: 'violet', color: '#7c3aed' },
      metadata: { status: 'ready' },
    }

    const resource = resourceSummaryFromDto(dto)

    expect(resource).toEqual({
      key: dto.key,
      name: 'Fixture card',
      kind: 'fixture-card',
      capabilities: ['read'],
      appearance: dto.appearance,
      metadata: { status: 'ready' },
    })
    expect(resource.appearance).toBe(dto.appearance)
    expect(resource.metadata).not.toHaveProperty('appearance')
  })

  test('sends contributor and resource scope for provider-local search', async () => {
    const originalFetch = globalThis.fetch
    const abort = new AbortController()
    const requests: { url: URL; signal: AbortSignal | null }[] = []
    globalThis.fetch = ((input, init) => {
      requests.push({
        url: new URL(String(input), 'http://localhost'),
        signal: (init?.signal as AbortSignal | undefined) ?? null,
      })
      return Promise.resolve(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            truncated: false,
            results: [],
            failures: [],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as typeof fetch

    try {
      await serverIntegrationSearchContributor.search({
        query: 'needle',
        limit: 50,
        signal: abort.signal,
        contributorIds: ['filesystem.knowledge'],
        scope: { provider: 'filesystem', id: 'v1:18:configured-defaultNotes' },
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    const request = requests[0]
    expect(request?.url.pathname).toBe('/api/search')
    expect(request?.url.searchParams.get('q')).toBe('needle')
    expect(request?.url.searchParams.get('limit')).toBe('50')
    expect(request?.url.searchParams.get('contributors')).toBe('filesystem.knowledge')
    expect(request?.url.searchParams.get('scopeProvider')).toBe('filesystem')
    expect(request?.url.searchParams.get('scopeResource')).toBe('v1:18:configured-defaultNotes')
    expect(request?.signal).toBe(abort.signal)
  })
})
