import { describe, expect, test } from 'bun:test'
import contract from '../fixtures/resource-contract.json'
import { isResourcePage, type ResourcePage } from '@/lib/resource'

describe('Resource read contract', () => {
  test('TypeScript accepts shared Rust golden fixture', () => {
    expect(isResourcePage(contract)).toBe(true)
    const page = contract as ResourcePage
    expect(page.items[0].ref).toEqual({
      libraryId: 'library-installation',
      resourceId: 'resource-video',
    })
    expect(page.items[0].version).toBe('fs:v1:opaque')
  })

  test('rejects client-inferred numeric versions and path-only identities', () => {
    const invalid = structuredClone(contract) as Record<string, any>
    invalid.items[0].version = 1234
    delete invalid.items[0].ref
    expect(isResourcePage(invalid)).toBe(false)
  })
})
