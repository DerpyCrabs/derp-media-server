import { describe, expect, test } from 'bun:test'
import type { ResourceSummaryDto } from '@/lib/generated/api-contracts'
import { resourceSummaryFromDto } from '@/src/integrations/http-client'

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
})
