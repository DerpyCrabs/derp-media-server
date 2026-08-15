import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  tryPasteKnowledgeBaseImage,
  type KbImagePasteContext,
} from '@/features/viewer/handle-kb-image-paste'

type RecordedRequest = { url: string; body: Record<string, unknown> }

const originalFetch = globalThis.fetch
let requests: RecordedRequest[] = []

afterAll(() => {
  globalThis.fetch = originalFetch
})

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
})

function makeImagePaste() {
  const file = new File([new Uint8Array([1, 2, 3])], 'clipboard.png', { type: 'image/png' })
  let prevented = false
  const event = {
    clipboardData: { items: [{ type: file.type, getAsFile: () => file }] },
    preventDefault: () => {
      prevented = true
    },
  } as unknown as ClipboardEvent
  return { event, wasPrevented: () => prevented }
}

function makeContext(overrides: Partial<KbImagePasteContext> = {}): KbImagePasteContext {
  return {
    viewingPath: 'Notes/note.md',
    knowledgeBases: ['Notes'],
    editableFolders: ['Notes'],
    completeCodeMirrorPaste: () => true,
    ...overrides,
  }
}

describe('tryPasteKnowledgeBaseImage', () => {
  test('creates and inserts an image attachment', async () => {
    const paste = makeImagePaste()
    let completed: string | null | undefined

    expect(
      await tryPasteKnowledgeBaseImage(
        paste.event,
        makeContext({
          completeCodeMirrorPaste: (markdown) => {
            completed = markdown
            return true
          },
        }),
      ),
    ).toBe(true)
    expect(paste.wasPrevented()).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('/api/files/create')
    expect(requests[0]!.body.path).toMatch(/^Notes\/images\/Pasted image \d{14}\.png$/)
    expect(completed).toMatch(/^!\[\[Pasted image \d{14}\.png\]\]$/)
  })

  test('rolls back an attachment when the editor rejects completion', async () => {
    const paste = makeImagePaste()
    expect(
      await tryPasteKnowledgeBaseImage(
        paste.event,
        makeContext({ completeCodeMirrorPaste: () => false }),
      ),
    ).toBe(true)
    expect(requests.map((request) => request.url)).toEqual([
      '/api/files/create',
      '/api/files/delete',
    ])
    expect(requests[1]!.body.path).toBe(requests[0]!.body.path)
  })

  test('ignores non-Markdown files and non-editable knowledge bases', async () => {
    const nonMarkdown = makeImagePaste()
    expect(
      await tryPasteKnowledgeBaseImage(
        nonMarkdown.event,
        makeContext({ viewingPath: 'Notes/note.txt' }),
      ),
    ).toBe(false)
    expect(nonMarkdown.wasPrevented()).toBe(false)

    const locked = makeImagePaste()
    expect(
      await tryPasteKnowledgeBaseImage(locked.event, makeContext({ editableFolders: [] })),
    ).toBe(false)
    expect(locked.wasPrevented()).toBe(false)
    expect(requests).toHaveLength(0)
  })
})
