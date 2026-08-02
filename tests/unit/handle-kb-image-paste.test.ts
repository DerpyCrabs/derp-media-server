import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { tryPasteKnowledgeBaseImage, type KbImagePasteContext } from '@/lib/handle-kb-image-paste'
import { buildResolveMarkdownImageUrl } from '@/lib/resolve-markdown-image-url'

type RecordedRequest = {
  url: string
  body: Record<string, unknown>
}

const originalFetch = globalThis.fetch
let requests: RecordedRequest[] = []

afterAll(() => {
  globalThis.fetch = originalFetch
})

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (input, init) => {
    const url = String(input)
    requests.push({
      url,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    const body = url.includes('/upload-image')
      ? {
          success: true,
          fileName: 'shared-image.png',
          path: 'Shared/images/shared-image.png',
          rollbackId: 'rollback-capability',
        }
      : { success: true }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
})

function makeImagePaste(target: EventTarget | null = null) {
  const file = new File([new Uint8Array([1, 2, 3])], 'clipboard.png', {
    type: 'image/png',
  })
  let prevented = false
  const event = {
    clipboardData: {
      items: [{ type: file.type, getAsFile: () => file }],
    },
    target,
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
    shareContext: null,
    shareCanEdit: false,
    shareCanUpload: false,
    completeCodeMirrorPaste: () => true,
    ...overrides,
  }
}

describe('tryPasteKnowledgeBaseImage', () => {
  test('completes CodeMirror paste without splicing stale editor content', async () => {
    const paste = makeImagePaste()
    let completed: string | null | undefined

    const handled = await tryPasteKnowledgeBaseImage(
      paste.event,
      makeContext({
        completeCodeMirrorPaste: (markdown) => {
          completed = markdown
          return true
        },
      }),
    )

    expect(handled).toBe(true)
    expect(paste.wasPrevented()).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('/api/files/create')
    expect(requests[0]!.body.path).toMatch(/^Notes\/images\/Pasted image \d{14}\.png$/)
    const fileName = String(requests[0]!.body.path).slice('Notes/images/'.length)
    const inserted = `![[${fileName}]]`
    expect(completed).toBe(inserted)
  })

  test('removes an admin attachment when its editor no longer accepts completion', async () => {
    const paste = makeImagePaste()

    const handled = await tryPasteKnowledgeBaseImage(
      paste.event,
      makeContext({ completeCodeMirrorPaste: () => false }),
    )

    expect(handled).toBe(true)
    expect(requests.map((request) => request.url)).toEqual([
      '/api/files/create',
      '/api/files/delete',
    ])
    expect(requests[1]!.body.path).toBe(requests[0]!.body.path)
  })

  test('does not upload images from non-Markdown editable shares', async () => {
    const paste = makeImagePaste()
    const handled = await tryPasteKnowledgeBaseImage(
      paste.event,
      makeContext({
        viewingPath: 'Shared/notes.txt',
        knowledgeBases: [],
        shareContext: { token: 'share-token', sharePath: 'Shared/notes.txt', isDirectory: false },
        shareCanEdit: true,
        shareCanUpload: true,
      }),
    )

    expect(handled).toBe(false)
    expect(paste.wasPrevented()).toBe(false)
    expect(requests).toHaveLength(0)
  })

  test('keeps editable shares on token-scoped upload route', async () => {
    const paste = makeImagePaste()
    let content = ''

    const handled = await tryPasteKnowledgeBaseImage(
      paste.event,
      makeContext({
        shareContext: { token: 'share-token', sharePath: 'Notes/note.md', isDirectory: false },
        shareCanEdit: true,
        shareCanUpload: true,
        completeCodeMirrorPaste: (markdown) => {
          content = markdown ?? ''
          return true
        },
      }),
    )

    expect(handled).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.url).toBe('/api/share/share-token/upload-image')
    expect(requests[1]!.url).toBe('/api/share/share-token/finalize-image-upload')
    expect(content).toBe('![[shared-image.png]]')
    expect(
      buildResolveMarkdownImageUrl(
        'Notes/note.md',
        { token: 'share-token', sharePath: 'Notes/note.md', isDirectory: false },
        ['Notes'],
      )('shared-image.png'),
    ).toBe('/api/share/share-token/media/Notes/images/shared-image.png')
  })

  test('denies image upload when editable share lacks upload permission', async () => {
    const paste = makeImagePaste()

    const handled = await tryPasteKnowledgeBaseImage(
      paste.event,
      makeContext({
        shareContext: { token: 'share-token', sharePath: 'Notes/note.md', isDirectory: false },
        shareCanEdit: true,
        shareCanUpload: false,
      }),
    )

    expect(handled).toBe(false)
    expect(paste.wasPrevented()).toBe(false)
    expect(requests).toHaveLength(0)
  })

  test('inserts resolvable share-relative image path for non-KB directory share', async () => {
    const paste = makeImagePaste()
    const shareContext = {
      token: 'share-token',
      sharePath: 'Shared/Project',
      isDirectory: true,
    }
    const viewingPath = 'Shared/Project/notes/note.md'
    let content = ''

    const handled = await tryPasteKnowledgeBaseImage(
      paste.event,
      makeContext({
        viewingPath,
        knowledgeBases: [],
        shareContext,
        shareCanEdit: true,
        shareCanUpload: true,
        completeCodeMirrorPaste: (markdown) => {
          content = markdown ?? ''
          return true
        },
      }),
    )

    expect(handled).toBe(true)
    expect(paste.wasPrevented()).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.url).toBe('/api/share/share-token/upload-image')
    expect(requests[1]!.url).toBe('/api/share/share-token/finalize-image-upload')
    expect(content).toBe('![[Shared/Project/images/shared-image.png]]')

    const insertedSrc = content.match(/^!\[\[([^\]]+)\]\]/)?.[1]
    expect(insertedSrc).toBeDefined()
    expect(buildResolveMarkdownImageUrl(viewingPath, shareContext, [])(insertedSrc!)).toBe(
      '/api/share/share-token/media/images/shared-image.png',
    )
  })

  test('inserts sibling images path for non-KB single-file share', async () => {
    const paste = makeImagePaste()
    const shareContext = {
      token: 'share-token',
      sharePath: 'Shared/note.md',
      isDirectory: false,
    }
    let content = ''

    const handled = await tryPasteKnowledgeBaseImage(
      paste.event,
      makeContext({
        viewingPath: 'Shared/note.md',
        knowledgeBases: [],
        shareContext,
        shareCanEdit: true,
        shareCanUpload: true,
        completeCodeMirrorPaste: (markdown) => {
          content = markdown ?? ''
          return true
        },
      }),
    )

    expect(handled).toBe(true)
    expect(paste.wasPrevented()).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.url).toBe('/api/share/share-token/upload-image')
    expect(requests[1]!.url).toBe('/api/share/share-token/finalize-image-upload')
    expect(content).toBe('![[images/shared-image.png]]')
    expect(
      buildResolveMarkdownImageUrl('Shared/note.md', shareContext, [])('images/shared-image.png'),
    ).toBe('/api/share/share-token/media/Shared/images/shared-image.png')
  })

  test('cancels a share upload when its editor no longer accepts completion', async () => {
    const paste = makeImagePaste()

    const handled = await tryPasteKnowledgeBaseImage(
      paste.event,
      makeContext({
        viewingPath: 'Shared/note.md',
        knowledgeBases: [],
        shareContext: {
          token: 'share-token',
          sharePath: 'Shared/note.md',
          isDirectory: false,
        },
        shareCanEdit: true,
        shareCanUpload: true,
        completeCodeMirrorPaste: () => false,
      }),
    )

    expect(handled).toBe(true)
    expect(requests.map((request) => request.url)).toEqual([
      '/api/share/share-token/upload-image',
      '/api/share/share-token/cancel-image-upload',
    ])
    expect(requests[1]!.body.rollbackId).toBe('rollback-capability')
  })

  test('nested KB directory share inserts bare attachment resolving through full KB path', async () => {
    const paste = makeImagePaste()
    const shareContext = {
      token: 'share-token',
      sharePath: 'Notes/projects',
      isDirectory: true,
    }
    const viewingPath = 'Notes/projects/note.md'
    let content = ''

    const handled = await tryPasteKnowledgeBaseImage(
      paste.event,
      makeContext({
        viewingPath,
        knowledgeBases: ['Notes'],
        shareContext,
        shareCanEdit: true,
        shareCanUpload: true,
        completeCodeMirrorPaste: (markdown) => {
          content = markdown ?? ''
          return true
        },
      }),
    )

    expect(handled).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.url).toBe('/api/share/share-token/upload-image')
    expect(requests[1]!.url).toBe('/api/share/share-token/finalize-image-upload')
    expect(content).toBe('![[shared-image.png]]')
    expect(
      buildResolveMarkdownImageUrl(viewingPath, shareContext, ['Notes'])('shared-image.png'),
    ).toBe('/api/share/share-token/knowledge-base-image/Notes/images/shared-image.png')
  })

  test('does not upload when share or admin context lacks authorization', async () => {
    const sharePaste = makeImagePaste()
    const adminPaste = makeImagePaste()

    expect(
      await tryPasteKnowledgeBaseImage(
        sharePaste.event,
        makeContext({
          shareContext: { token: 'share-token', sharePath: 'Notes/note.md', isDirectory: false },
          shareCanEdit: false,
        }),
      ),
    ).toBe(false)
    expect(
      await tryPasteKnowledgeBaseImage(adminPaste.event, makeContext({ editableFolders: [] })),
    ).toBe(false)

    expect(sharePaste.wasPrevented()).toBe(false)
    expect(adminPaste.wasPrevented()).toBe(false)
    expect(requests).toHaveLength(0)
  })
})
