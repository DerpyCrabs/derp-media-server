import { describe, expect, test } from 'bun:test'

import {
  createTextDocumentTarget,
  enqueueTextDocumentSave,
  textDocumentPath,
  textDocumentTargetKey,
} from '@/lib/text-document-target'
import { filesystemResourceKey } from '@/lib/domain/resource'
import { readTextEditorDraft, textEditorDraftKey } from '@/lib/text-editor-draft'

describe('text document targets', () => {
  test('identifies a document by filesystem ResourceKey', () => {
    const resource = filesystemResourceKey('media', 'Notes/note.md')
    const target = createTextDocumentTarget(resource)
    expect(target).toEqual({ resource })
    expect(textDocumentPath(target)).toBe('Notes/note.md')
    expect(textDocumentTargetKey(target)).toBe(JSON.stringify([resource.provider, resource.id]))
  })

  test('serializes separately-created targets for the same document', async () => {
    const resource = filesystemResourceKey('media', 'Notes/note.md')
    const firstTarget = createTextDocumentTarget(resource)
    const secondTarget = createTextDocumentTarget(resource)
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

  test('reads drafts only from the canonical resource key', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    }
    const resource = filesystemResourceKey('media', 'Notes/note.md')
    const target = createTextDocumentTarget(resource)
    const currentKey = textEditorDraftKey(target.resource)
    values.set(currentKey, JSON.stringify({ content: 'recover me', updatedAt: 42 }))

    expect(readTextEditorDraft(currentKey, storage)).toEqual({
      content: 'recover me',
      updatedAt: 42,
    })
    expect(values.get(currentKey)).toBe(JSON.stringify({ content: 'recover me', updatedAt: 42 }))
  })
})
