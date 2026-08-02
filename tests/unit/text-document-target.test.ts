import { describe, expect, test } from 'bun:test'

import {
  createTextDocumentTarget,
  enqueueTextDocumentSave,
  textDocumentDraftScope,
  textDocumentTargetKey,
} from '@/lib/text-document-target'

describe('text document targets', () => {
  test('includes access scope, share root, and viewing path in identity', () => {
    const admin = createTextDocumentTarget('Notes/note.md', null)
    const firstShare = createTextDocumentTarget('Notes/note.md', {
      token: 'token',
      sharePath: 'Notes',
    })
    const otherRoot = createTextDocumentTarget('Notes/note.md', {
      token: 'token',
      sharePath: 'Other',
    })
    const otherToken = createTextDocumentTarget('Notes/note.md', {
      token: 'other-token',
      sharePath: 'Notes',
    })

    expect(
      new Set([admin, firstShare, otherRoot, otherToken].map(textDocumentTargetKey)).size,
    ).toBe(4)
    expect(textDocumentDraftScope(firstShare)).not.toBe(textDocumentDraftScope(otherRoot))
    expect(textDocumentDraftScope(firstShare)).not.toBe(textDocumentDraftScope(otherToken))
  })

  test('avoids delimiter collisions in path-like values', () => {
    const left = createTextDocumentTarget('c', { token: 'a', sharePath: 'b|c' })
    const right = createTextDocumentTarget('b|c', { token: 'a', sharePath: 'c' })

    expect(textDocumentTargetKey(left)).not.toBe(textDocumentTargetKey(right))
  })

  test('serializes separately-created targets for the same document', async () => {
    const firstTarget = createTextDocumentTarget('Notes/note.md', null)
    const secondTarget = createTextDocumentTarget('Notes/note.md', null)
    const events: string[] = []
    let releaseFirst: (() => void) | undefined

    const first = enqueueTextDocumentSave(firstTarget, async () => {
      events.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      events.push('first:end')
    })
    const second = enqueueTextDocumentSave(secondTarget, async () => {
      events.push('second:start')
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })

  test('does not serialize the same path across different scopes', async () => {
    const admin = createTextDocumentTarget('Notes/note.md', null)
    const share = createTextDocumentTarget('Notes/note.md', {
      token: 'token',
      sharePath: 'Notes',
    })
    const events: string[] = []
    let releaseAdmin: (() => void) | undefined

    const adminSave = enqueueTextDocumentSave(admin, async () => {
      events.push('admin:start')
      await new Promise<void>((resolve) => {
        releaseAdmin = resolve
      })
    })
    const shareSave = enqueueTextDocumentSave(share, async () => {
      events.push('share:start')
    })

    await Promise.resolve()
    expect(events).toEqual(['admin:start', 'share:start'])
    await shareSave
    releaseAdmin?.()
    await adminSave
  })
})
