import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  directoryFilesSchema,
  directoryListingSchema,
  fileSearchResponseSchema,
} from '@/lib/files/file-schemas'
import { MediaType } from '@/lib/files/types'

const file = {
  name: 'note.md',
  path: 'Notes/note.md',
  type: MediaType.TEXT,
  size: 12,
  extension: 'md',
  isDirectory: false,
}

describe('file response schemas', () => {
  test('validates file kinds and numeric fields before publishing a listing', () => {
    const decode = Schema.decodeUnknownSync(directoryFilesSchema)
    expect(decode({ files: [file] }).files[0]).toEqual(file)
    expect(() => decode({ files: [{ ...file, size: '12' }] })).toThrow()
    expect(() => decode({ files: [{ ...file, type: 'unknown-media-kind' }] })).toThrow()
  })

  test('normalizes nullable Rust directory metadata', () => {
    const decode = Schema.decodeUnknownSync(directoryListingSchema)
    expect(
      decode({ files: [file], virtualDirectory: null, virtualEntries: {} }).virtualDirectory,
    ).toBeUndefined()
    const listing = decode({
      files: [],
      virtualDirectory: {
        provider: 'hermes',
        kind: 'project',
        path: 'hermes/test',
        capabilities: ['createFile'],
        offset: 0,
        pageSize: 50,
        total: 0,
        nextOffset: null,
      },
      virtualEntries: {
        'hermes/test': {
          provider: 'hermes',
          kind: 'project',
          id: 'test',
          metadata: { name: 'Test' },
          appearance: { icon: 'project', tone: 'indigo', color: null },
        },
      },
    })
    expect(listing.virtualDirectory?.nextOffset).toBeUndefined()
    expect(listing.virtualEntries?.['hermes/test']?.capabilities).toEqual([])
    expect(listing.virtualEntries?.['hermes/test']?.appearance?.color).toBeUndefined()
  })

  test('retains provider-specific open target fields while validating their common contract', () => {
    const decode = Schema.decodeUnknownSync(directoryListingSchema)
    const entry = {
      provider: 'hermes',
      kind: 'session',
      capabilities: ['open'],
      openTarget: { provider: 'hermes', type: 'hermesSession', sessionId: 's1', readOnly: true },
    }
    expect(
      decode({ files: [], virtualEntries: { session: entry } }).virtualEntries?.session?.openTarget,
    ).toEqual(entry.openTarget)
    expect(() =>
      decode({
        files: [],
        virtualEntries: {
          session: { ...entry, openTarget: { provider: 'hermes', sessionId: 's1' } },
        },
      }),
    ).toThrow()
  })

  test('rejects malformed search status nested inside a search response', () => {
    const decode = Schema.decodeUnknownSync(fileSearchResponseSchema)
    const status = {
      state: 'ready',
      stale: false,
      indexedEntries: 1,
      scannedDirectories: 1,
      watcherCount: 1,
      roots: [
        {
          id: 'root',
          name: 'Media',
          state: 'ready',
          refreshMode: 'recursive-watch',
          indexedEntries: 1,
          scannedDirectories: 1,
          lastCompleteAt: null,
        },
      ],
    }
    expect(
      decode({ results: [], truncated: false, status }).status.roots[0]?.lastCompleteAt,
    ).toBeNull()
    expect(() =>
      decode({ results: [], truncated: false, status: { ...status, watcherCount: 'one' } }),
    ).toThrow()
  })
})
