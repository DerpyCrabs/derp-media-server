import { describe, expect, test } from 'bun:test'

import {
  beginSingleFileShareImagePreviewSave,
  consumeShareImageRollbackGrant,
  createShareImageRollbackGrant,
  finalizeSingleFileShareImagePreview,
  isAuthorizedSingleFileShareImage,
  recordSingleFileShareImagePreview,
  referencedSharedMarkdownImagePaths,
  settleSingleFileShareImagePreviewsAfterSave,
} from '@/server/lib/shared-markdown-images'

describe('single-file Markdown share image references', () => {
  test('collects inline, reference, and Obsidian image destinations', () => {
    const source = [
      '![inline](images/pic%20one.png)',
      '![reference][asset]',
      '![[local&amp;.webp|Preview]]',
      '',
      '[asset]: sibling.jpg',
    ].join('\n')

    expect([...referencedSharedMarkdownImagePaths(source, 'Shared/note.md', [])].sort()).toEqual(
      ['Shared/images/pic one.png', 'Shared/local&.webp', 'Shared/sibling.jpg'].sort(),
    )
  })

  test('allows only image files in direct sibling attachment locations', () => {
    const source = [
      '![good](images/good.png)',
      '![text](images/private.txt)',
      '![nested](images/nested/private.png)',
      '![outside](../Private/private.png)',
      '![remote](https://example.com/image.png)',
    ].join('\n')

    expect([...referencedSharedMarkdownImagePaths(source, 'Shared/note.md', [])]).toEqual([
      'Shared/images/good.png',
    ])
  })

  test('maps bare knowledge-base references to its image directory', () => {
    const source = '![diagram](diagram.png) ![not image](secret.txt)'

    expect([
      ...referencedSharedMarkdownImagePaths(source, 'Notes/projects/note.md', ['Notes']),
    ]).toEqual(['Notes/images/diagram.png'])
  })

  test('respects configured knowledge-base order for overlapping roots', () => {
    const source = '![[diagram.png]]'

    expect([
      ...referencedSharedMarkdownImagePaths(source, 'Notes/sub/note.md', ['Notes', 'Notes/sub']),
    ]).toEqual(['Notes/images/diagram.png'])
    expect([
      ...referencedSharedMarkdownImagePaths(source, 'Notes/sub/note.md', ['Notes/sub', 'Notes']),
    ]).toEqual(['Notes/sub/images/diagram.png'])
  })

  test('keeps URL-decoded space and literal percent filenames distinct', () => {
    const source = '![space](images/a%20b.png) ![percent](images/a%2520b.png)'

    expect([...referencedSharedMarkdownImagePaths(source, 'Shared/note.md', [])]).toEqual([
      'Shared/images/a b.png',
      'Shared/images/a%20b.png',
    ])
  })

  test('maps root single-file references to root sibling locations', () => {
    const source = '![direct](pic.png) ![folder](images/pic.png)'

    expect([...referencedSharedMarkdownImagePaths(source, 'note.md', [])]).toEqual([
      'pic.png',
      'images/pic.png',
    ])
  })

  test('temporarily permits only exact images uploaded through the same file share', async () => {
    recordSingleFileShareImagePreview(
      'upload-token',
      'Shared/note.md',
      'Shared/images/new image.png',
    )

    expect(
      await isAuthorizedSingleFileShareImage(
        'upload-token',
        'Shared/note.md',
        'Shared/images/new image.png',
        [],
      ),
    ).toBe(true)
    expect(
      await isAuthorizedSingleFileShareImage(
        'upload-token',
        'Shared/other.md',
        'Shared/images/new image.png',
        [],
      ),
    ).toBe(false)
    expect(
      await isAuthorizedSingleFileShareImage(
        'different-token',
        'Shared/note.md',
        'Shared/images/new image.png',
        [],
      ),
    ).toBe(false)
    expect(
      await isAuthorizedSingleFileShareImage(
        'upload-token',
        'Shared/note.md',
        'Shared/images/other.png',
        [],
      ),
    ).toBe(false)
  })

  test('rollback capability is random, scoped, and one-time', () => {
    const id = createShareImageRollbackGrant(
      'rollback-token',
      'Shared/note.md',
      'Shared/images/new image.png',
      123,
    )

    expect(consumeShareImageRollbackGrant(id, 'other-token', 'Shared/note.md')).toBeNull()
    expect(consumeShareImageRollbackGrant(id, 'rollback-token', 'Shared/other.md')).toBeNull()
    expect(consumeShareImageRollbackGrant(id, 'rollback-token', 'Shared/note.md')).toMatchObject({
      uploadedPath: 'Shared/images/new image.png',
      accountedBytes: 123,
    })
    expect(consumeShareImageRollbackGrant(id, 'rollback-token', 'Shared/note.md')).toBeNull()
  })

  test('revokes finalized previews after a Markdown save', async () => {
    recordSingleFileShareImagePreview(
      'settled-token',
      'Shared/note.md',
      'Shared/images/removed.png',
    )
    finalizeSingleFileShareImagePreview(
      'settled-token',
      'Shared/note.md',
      'Shared/images/removed.png',
    )
    const saveStartedAt = beginSingleFileShareImagePreviewSave()
    settleSingleFileShareImagePreviewsAfterSave(
      'settled-token',
      'Shared/note.md',
      '# Saved without image',
      [],
      saveStartedAt,
    )

    expect(
      await isAuthorizedSingleFileShareImage(
        'settled-token',
        'Shared/note.md',
        'Shared/images/removed.png',
        [],
      ),
    ).toBe(false)
  })

  test('keeps unrelated pending uploads until completion or expiry', async () => {
    recordSingleFileShareImagePreview(
      'pending-token',
      'Shared/note.md',
      'Shared/images/pending.png',
    )
    const saveStartedAt = beginSingleFileShareImagePreviewSave()
    settleSingleFileShareImagePreviewsAfterSave(
      'pending-token',
      'Shared/note.md',
      '# Concurrent save',
      [],
      saveStartedAt,
    )

    expect(
      await isAuthorizedSingleFileShareImage(
        'pending-token',
        'Shared/note.md',
        'Shared/images/pending.png',
        [],
      ),
    ).toBe(true)
  })

  test('does not let an older save revoke a preview finalized while it was in flight', async () => {
    recordSingleFileShareImagePreview('race-token', 'Shared/note.md', 'Shared/images/race.png')
    const saveStartedAt = beginSingleFileShareImagePreviewSave()
    finalizeSingleFileShareImagePreview('race-token', 'Shared/note.md', 'Shared/images/race.png')
    settleSingleFileShareImagePreviewsAfterSave(
      'race-token',
      'Shared/note.md',
      '# Older save snapshot',
      [],
      saveStartedAt,
    )

    expect(
      await isAuthorizedSingleFileShareImage(
        'race-token',
        'Shared/note.md',
        'Shared/images/race.png',
        [],
      ),
    ).toBe(true)
  })

  test('revokes rollback capability once its image is persisted', () => {
    const rollbackId = createShareImageRollbackGrant(
      'persisted-token',
      'Shared/note.md',
      'Shared/images/persisted.png',
      10,
    )
    settleSingleFileShareImagePreviewsAfterSave(
      'persisted-token',
      'Shared/note.md',
      '![persisted](images/persisted.png)',
      [],
      beginSingleFileShareImagePreviewSave(),
    )

    expect(
      consumeShareImageRollbackGrant(rollbackId, 'persisted-token', 'Shared/note.md'),
    ).toBeNull()
  })
})
