import { describe, expect, test } from 'bun:test'

import {
  createTextDocumentTarget,
  enqueueTextDocumentSave,
  textDocumentDraftScope,
  textDocumentTargetKey,
} from '@/features/viewer/text-document-target'

describe('text document targets', () => {
  test('identifies a document by admin path', () => {
    const target = createTextDocumentTarget('Notes/note.md')
    expect(target).toEqual({ kind: 'admin', viewingPath: 'Notes/note.md' })
    expect(textDocumentTargetKey(target)).toContain('Notes/note.md')
    expect(textDocumentDraftScope(target)).toBe('admin')
  })

  test('serializes separately-created targets for the same document', async () => {
    const firstTarget = createTextDocumentTarget('Notes/note.md')
    const secondTarget = createTextDocumentTarget('Notes/note.md')
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
})
