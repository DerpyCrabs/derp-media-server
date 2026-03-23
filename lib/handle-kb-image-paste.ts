import { post } from '@/lib/api'
import {
  blobToBase64,
  formatObsidianPastedImageFileName,
  spliceString,
} from '@/lib/pasted-kb-image'
import type { MarkdownImageShareContext } from '@/lib/resolve-markdown-image-url'
import { getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'

export type KbImagePasteContext = {
  viewingPath: string
  knowledgeBases: string[]
  editableFolders: string[]
  shareContext: MarkdownImageShareContext | null
  shareCanEdit: boolean
  editContent: string
  setEditContent: (value: string) => void
}

async function createKbImageWithUniqueName(
  kbRoot: string,
  baseName: string,
  base64: string,
): Promise<string> {
  const dir = `${kbRoot}/images`
  const m = /^(.+?)(\.[^.]+)$/.exec(baseName)
  const stem = m ? m[1]! : baseName
  const ext = m ? m[2]!.slice(1) : 'png'

  for (let n = 0; n < 100; n++) {
    const name = n === 0 ? baseName : `${stem}_${n}.${ext}`
    const fullPath = `${dir}/${name}`
    try {
      await post('/api/files/create', {
        type: 'file',
        path: fullPath,
        base64Content: base64,
      })
      return name
    } catch (e: unknown) {
      const status =
        e && typeof e === 'object' && 'status' in e ? (e as { status: number }).status : 0
      if (status === 409) continue
      throw e
    }
  }
  throw new Error('Could not find a free image file name')
}

/**
 * When the clipboard contains an image and the open note is inside a knowledge base,
 * saves under `{kbRoot}/images/` and inserts `![[filename]]` at the caret.
 * Returns true if the paste was handled (caller should have called preventDefault).
 */
export async function tryPasteKnowledgeBaseImage(
  e: ClipboardEvent,
  ctx: KbImagePasteContext,
): Promise<boolean> {
  const normPath = ctx.viewingPath.replace(/\\/g, '/')
  const kbRoot = getKnowledgeBaseRoot(normPath, ctx.knowledgeBases)
  if (!kbRoot) return false

  const items = e.clipboardData?.items
  if (!items?.length) return false

  const imgItem = Array.from(items).find((it) => it.type.startsWith('image/'))
  if (!imgItem) return false

  const file = imgItem.getAsFile()
  if (!file) return false

  const ta = e.target
  if (!(ta instanceof HTMLTextAreaElement)) return false

  if (ctx.shareContext) {
    if (!ctx.shareCanEdit) return false
  } else if (!isPathEditable(`${kbRoot}/images`, ctx.editableFolders)) {
    return false
  }

  e.preventDefault()

  const mimeType = file.type || 'image/png'
  const preferredName = formatObsidianPastedImageFileName(mimeType)

  const start = ta.selectionStart ?? 0
  const end = ta.selectionEnd ?? 0

  try {
    const base64 = await blobToBase64(file)
    let usedName: string
    if (ctx.shareContext) {
      const res = await post<{ success: boolean; fileName: string }>(
        `/api/share/${ctx.shareContext.token}/upload-image`,
        {
          base64Content: base64,
          mimeType,
          fileName: preferredName,
        },
      )
      usedName = res.fileName
    } else {
      usedName = await createKbImageWithUniqueName(kbRoot, preferredName, base64)
    }

    const insert = `![[${usedName}]]`
    ctx.setEditContent(spliceString(ctx.editContent, start, end, insert))

    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + insert.length
      ta.setSelectionRange(pos, pos)
    })
  } catch (e) {
    window.alert(e instanceof Error ? e.message : 'Failed to save pasted image')
  }

  return true
}
