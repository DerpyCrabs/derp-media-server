import { post } from '@/lib/api/client'
import { blobToBase64, formatObsidianPastedImageFileName } from '@/lib/files/pasted-kb-image'
import { getKnowledgeBaseRoot, isPathEditable } from '@/lib/files/path-utils'

export type KbImagePasteContext = {
  viewingPath: string
  knowledgeBases: string[]
  editableFolders: string[]
  completeCodeMirrorPaste: (markdown: string | null) => boolean
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

/** Upload a clipboard image and complete insertion with Obsidian syntax. */
export async function tryPasteKnowledgeBaseImage(
  e: ClipboardEvent,
  ctx: KbImagePasteContext,
): Promise<boolean> {
  const normPath = ctx.viewingPath.replace(/\\/g, '/')
  if (!/\.md$/i.test(normPath)) return false
  const kbRoot = getKnowledgeBaseRoot(normPath, ctx.knowledgeBases)
  if (!kbRoot || !isPathEditable(`${kbRoot}/images`, ctx.editableFolders)) return false

  const items = e.clipboardData?.items
  if (!items?.length) return false
  const imgItem = Array.from(items).find((it) => it.type.startsWith('image/'))
  if (!imgItem) return false
  const file = imgItem.getAsFile()
  if (!file) return false

  e.preventDefault()
  const mimeType = file.type || 'image/png'
  const preferredName = formatObsidianPastedImageFileName(mimeType)

  try {
    const base64 = await blobToBase64(file)
    const usedName = await createKbImageWithUniqueName(kbRoot, preferredName, base64)
    const insert = `![[${usedName}]]`
    if (!ctx.completeCodeMirrorPaste(insert)) {
      try {
        await post('/api/files/delete', { path: `${kbRoot}/images/${usedName}` })
      } catch (error) {
        console.error('Failed to roll back unused pasted image:', error)
      }
    }
  } catch (error) {
    ctx.completeCodeMirrorPaste(null)
    window.alert(error instanceof Error ? error.message : 'Failed to save pasted image')
  }

  return true
}
