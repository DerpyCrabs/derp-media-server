import { describe, expect, test } from 'bun:test'
import {
  CANVAS_CRASH_DRAFT_STORAGE_KEY,
  clearCanvasCrashDraft,
  createDefaultCanvasCollection,
  inspectCanvasCrashDraft,
  parseCanvasCollection,
  serializeCanvasCollection,
  writeCanvasCrashDraft,
} from '@/lib/canvas-persistence'
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('canvas persistence', () => {
  test('parses and serializes the revisioned authoritative schema', () => {
    const document = createDefaultCanvasCollection()
    const parsed = parseCanvasCollection(JSON.parse(serializeCanvasCollection(document)))

    expect(parsed).toEqual(document)
    expect(parsed?.schemaVersion).toBe(2)
    expect(parsed?.revision).toBe(0)
    expect(parseCanvasCollection({ ...document, writerId: 'retired' })).toBeNull()
    expect(
      parseCanvasCollection({
        ...document,
        canvases: [{ ...document.canvases[0], deleted: false }],
      }),
    ).toBeNull()
  })

  test('round-trips and explicitly clears a crash draft', () => {
    const source = storage()
    const document = createDefaultCanvasCollection()
    writeCanvasCrashDraft(source, document, 123)

    const inspected = inspectCanvasCrashDraft(source)
    expect(inspected.kind).toBe('valid')
    if (inspected.kind !== 'valid') throw new Error('expected valid draft')
    expect(inspected.value.baseRevision).toBe(document.revision)
    expect(inspected.value.savedAt).toBe(123)
    expect(inspected.value.canvases).toEqual(document.canvases)

    clearCanvasCrashDraft(source)
    expect(source.getItem(CANVAS_CRASH_DRAFT_STORAGE_KEY)).toBeNull()
  })

  test('preserves a corrupt crash draft byte-for-byte', () => {
    const raw = JSON.stringify({ schemaVersion: 1, baseRevision: 'broken' })
    const source = storage({ [CANVAS_CRASH_DRAFT_STORAGE_KEY]: raw })

    expect(inspectCanvasCrashDraft(source)).toEqual({ kind: 'corrupt', raw })
    expect(source.getItem(CANVAS_CRASH_DRAFT_STORAGE_KEY)).toBe(raw)
  })

  test('rejects an empty crash draft that cannot be displayed', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      baseRevision: 4,
      savedAt: 123,
      activeId: null,
      canvases: [],
    })
    const source = storage({ [CANVAS_CRASH_DRAFT_STORAGE_KEY]: raw })

    expect(inspectCanvasCrashDraft(source)).toEqual({ kind: 'corrupt', raw })
    expect(source.getItem(CANVAS_CRASH_DRAFT_STORAGE_KEY)).toBe(raw)
  })
})
