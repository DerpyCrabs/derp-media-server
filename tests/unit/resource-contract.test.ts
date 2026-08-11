import { describe, expect, test } from 'bun:test'
import contract from '../fixtures/resource-contract.json'
import errorContract from '../fixtures/catalog-error-contract.json'
import {
  isCatalogError,
  isPersistedResourceTarget,
  isResourcePage,
  isViewerId,
  persistedResourceTarget,
  type ResourcePage,
} from '@/lib/resource'

describe('Resource read contract', () => {
  test('TypeScript accepts shared Rust golden fixture', () => {
    expect(isResourcePage(contract)).toBe(true)
    const page = contract as ResourcePage
    expect(page.items[0].ref).toEqual({
      libraryId: 'library-installation',
      resourceId: 'resource-video',
    })
    expect(page.items[0].version).toBe('fs:v1:opaque')
    expect(page.items[0].preview).toEqual({ kind: 'thumbnail', available: true })
  })

  test('rejects client-inferred numeric versions and path-only identities', () => {
    const numericVersion = structuredClone(contract) as Record<string, any>
    numericVersion.items[0].version = 1234
    expect(isResourcePage(numericVersion)).toBe(false)

    const pathOnly = structuredClone(contract) as Record<string, any>
    delete pathOnly.items[0].ref
    expect(isResourcePage(pathOnly)).toBe(false)
  })

  test('persists empty compatibility locator for Library root identity', () => {
    const page = contract as ResourcePage
    const target = persistedResourceTarget(page.parent)
    expect(target).toEqual({
      ref: { libraryId: 'library-installation', resourceId: 'resource-library-root' },
      legacyLocator: '',
    })
    expect(isPersistedResourceTarget(target)).toBe(true)
    expect(
      isPersistedResourceTarget({
        ref: { libraryId: 'library-installation', resourceId: 'resource-library-root' },
      }),
    ).toBe(false)
  })

  test('accepts shared typed CatalogError fixture and rejects legacy transport errors', () => {
    expect(isCatalogError(errorContract)).toBe(true)
    expect(isCatalogError({ error: errorContract.message })).toBe(false)
    expect(isCatalogError({ ...errorContract, code: 'notARealCode' })).toBe(false)
  })

  test('locks persisted viewer descriptor identifiers', () => {
    expect(isViewerId('video-player')).toBe(true)
    expect(isViewerId('video')).toBe(false)
  })
})
