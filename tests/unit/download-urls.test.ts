import { describe, expect, test } from 'bun:test'
import { filesystemResourceAddress } from '@/lib/domain/resource'
import { filesystemDownloadHref } from '@/src/integrations/filesystem/download'

describe('filesystemDownloadHref', () => {
  test('uses opaque provider identity', () => {
    const url = new URL(filesystemDownloadHref('/a/b c'), 'http://application.test')
    expect(url.pathname).toBe('/api/integrations/filesystem/download')
    expect(
      filesystemResourceAddress({ provider: 'filesystem', id: url.searchParams.get('id')! }),
    ).toEqual({ rootId: 'configured-default', path: 'a/b c' })
  })
})
