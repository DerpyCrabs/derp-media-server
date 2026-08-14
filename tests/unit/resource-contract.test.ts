import { describe, expect, test } from 'bun:test'
import {
  FILESYSTEM_PROVIDER,
  filesystemResourceAddress,
  filesystemResourceKey,
  isResourceAppearance,
  isResourceError,
  isResourcePage,
  isResourceSummary,
  normalizeLogicalResourcePath,
  resourceKey,
  type ResourceError,
  type ResourcePage,
  type ResourceSummary,
} from '@/lib/domain/resource'
import filesystemResourceKeyParity from '@/tests/fixtures/filesystem-resource-key-parity.json'

describe('resource contracts', () => {
  test('keeps integration ids opaque while filesystem ids include root and normalized path', () => {
    expect(resourceKey('fixture', 'opaque/../session:one')).toEqual({
      provider: 'fixture',
      id: 'opaque/../session:one',
    })

    const first = filesystemResourceKey('root-a', 'Albums\\2026//./track.mp3')
    const same = filesystemResourceKey('root-a', '/Albums/2026/track.mp3/')
    const otherRoot = filesystemResourceKey('root-b', 'Albums/2026/track.mp3')

    expect(first).toEqual(same)
    expect(first).not.toEqual(otherRoot)
    expect(filesystemResourceAddress(first)).toEqual({
      rootId: 'root-a',
      path: 'Albums/2026/track.mp3',
    })
    expect(filesystemResourceAddress(resourceKey('fixture', first.id))).toBeNull()
    expect(first.provider).toBe(FILESYSTEM_PROVIDER)
  })

  test('matches UTF-8 filesystem key fixtures and rejects malformed byte lengths', () => {
    for (const fixture of filesystemResourceKeyParity.valid) {
      const key = filesystemResourceKey(fixture.rootId, fixture.path)
      expect(key.id).toBe(fixture.id)
      expect(filesystemResourceAddress(key)).toEqual({
        rootId: fixture.rootId,
        path: fixture.path,
      })
    }
    for (const id of filesystemResourceKeyParity.malformed) {
      expect(filesystemResourceAddress({ provider: FILESYSTEM_PROVIDER, id })).toBeNull()
    }
  })

  test('normalizes logical separators and rejects traversal', () => {
    expect(normalizeLogicalResourcePath('Notes\\./Daily//today.md')).toBe('Notes/Daily/today.md')
    expect(() => normalizeLogicalResourcePath('../outside')).toThrow('must not contain ..')
    expect(() => normalizeLogicalResourcePath('safe/../outside')).toThrow('must not contain ..')
    expect(() => normalizeLogicalResourcePath('bad\0path')).toThrow('must not contain NUL')
  })

  test('round-trips typed pages with open provider capabilities and presentation hints', () => {
    const summary: ResourceSummary = {
      key: resourceKey('fixture', 'opaque-card'),
      name: 'Fixture card',
      kind: 'fixture-card',
      mime: 'application/x-fixture',
      capabilities: ['read', 'fixture.pin'],
      presentation: 'fixture-card',
      appearance: { icon: 'Archive', tone: 'violet', color: '#7c3aed' },
      size: 42,
      metadata: { status: 'ready', viewCount: 3 },
    }
    const page: ResourcePage = {
      schemaVersion: 1,
      location: resourceKey('fixture', 'root'),
      locationSummary: {
        key: resourceKey('fixture', 'root'),
        name: 'Fixture root',
        kind: 'root',
        capabilities: ['browse'],
      },
      breadcrumbs: [
        {
          key: resourceKey('fixture', 'root'),
          name: 'Fixture root',
          kind: 'root',
          capabilities: ['browse'],
        },
      ],
      items: [summary],
      recentItems: [{ ...summary, metadata: { ...summary.metadata, modifiedAt: '2026-08-14' } }],
      nextCursor: 'opaque-cursor',
      total: 2,
    }
    const transported: unknown = JSON.parse(JSON.stringify(page))

    expect(isResourcePage(transported)).toBe(true)
    expect(transported).toEqual(page)

    const invalid = structuredClone(page) as Record<string, unknown>
    invalid.items = [{ ...summary, capabilities: [1] }]
    expect(isResourcePage(invalid)).toBe(false)
    expect(isResourcePage({ ...page, breadcrumbs: [{ bad: true }] })).toBe(false)
    expect(isResourcePage({ ...page, items: [{ ...summary, metadata: [] }] })).toBe(false)
    expect(isResourceSummary({ ...summary, appearance: { icon: 42 } })).toBe(false)
    expect(isResourcePage({ ...page, recentItems: [{ bad: true }] })).toBe(false)
  })

  test('validates neutral resource appearance hints', () => {
    expect(isResourceAppearance({})).toBe(true)
    expect(isResourceAppearance({ icon: 'Archive', tone: 'violet', color: '#7c3aed' })).toBe(true)
    expect(isResourceAppearance({ icon: 42 })).toBe(false)
    expect(isResourceAppearance({ tone: null })).toBe(false)
    expect(isResourceAppearance([])).toBe(false)
  })

  test('validates tagged transport errors without provider-specific branches', () => {
    const error: ResourceError = {
      schemaVersion: 1,
      code: 'unavailable',
      message: 'Fixture provider is offline',
      resource: resourceKey('fixture', 'opaque-card'),
      retryable: true,
    }

    expect(isResourceError(error)).toBe(true)
    expect(isResourceError({ ...error, code: 'fixture-only-error' })).toBe(false)
    expect(isResourceError({ ...error, retryable: 'yes' })).toBe(false)
  })
})
