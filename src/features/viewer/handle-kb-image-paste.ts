import { Effect } from 'effect'
import { isApiError, postEffect } from '@/lib/api/client'
import { blobToBase64, formatObsidianPastedImageFileName } from '@/lib/files/pasted-kb-image'
import { getKnowledgeBaseRoot, isPathEditable } from '@/lib/files/path-utils'
import { showAppAlertEffect } from '@/lib/ui/app-dialog'

export type KbImagePasteContext = {
  viewingPath: string
  knowledgeBases: string[]
  editableFolders: string[]
  completeCodeMirrorPaste: (markdown: string | null) => boolean
}

function createKbImageWithUniqueName(kbRoot: string, baseName: string, base64: string) {
  const match = /^(.+?)(\.[^.]+)$/.exec(baseName)
  const stem = match ? match[1]! : baseName
  const ext = match ? match[2]!.slice(1) : 'png'
  const attempt = (index: number): Effect.Effect<string, unknown> => {
    if (index >= 100) return Effect.fail(new Error('Could not find a free image file name'))
    const name = index === 0 ? baseName : `${stem}_${index}.${ext}`
    return postEffect('/api/files/create', {
      type: 'file',
      path: `${kbRoot}/images/${name}`,
      base64Content: base64,
    }).pipe(
      Effect.as(name),
      Effect.catch((error) =>
        isApiError(error) && error.status === 409 ? attempt(index + 1) : Effect.fail(error),
      ),
    )
  }
  return attempt(0)
}

export function tryPasteKnowledgeBaseImage(
  event: ClipboardEvent,
  context: KbImagePasteContext,
): false | Effect.Effect<void, unknown> {
  const path = context.viewingPath.replace(/\\/g, '/')
  if (!/\.md$/i.test(path)) return false
  const root = getKnowledgeBaseRoot(path, context.knowledgeBases)
  if (!root || !isPathEditable(`${root}/images`, context.editableFolders)) return false
  const file = Array.from(event.clipboardData?.items ?? [])
    .find((item) => item.type.startsWith('image/'))
    ?.getAsFile()
  if (!file) return false
  event.preventDefault()
  const name = formatObsidianPastedImageFileName(file.type || 'image/png')
  return Effect.gen(function* () {
    const base64 = yield* blobToBase64(file)
    const uploaded = yield* createKbImageWithUniqueName(root, name, base64)
    if (!context.completeCodeMirrorPaste(`![[${uploaded}]]`)) {
      yield* postEffect('/api/files/delete', { path: `${root}/images/${uploaded}` })
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        context.completeCodeMirrorPaste(null)
        yield* showAppAlertEffect(
          error instanceof Error ? error.message : 'Failed to save pasted image',
          'Could not save image',
        )
      }),
    ),
  )
}
