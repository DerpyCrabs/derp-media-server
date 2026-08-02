import { post } from '@/lib/api'
import { blobToBase64, formatObsidianPastedImageFileName } from '@/lib/pasted-kb-image'
import type { MarkdownImageShareContext } from '@/lib/resolve-markdown-image-url'
import { getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'

export type KbImagePasteContext = {
  viewingPath: string
  knowledgeBases: string[]
  editableFolders: string[]
  shareContext: MarkdownImageShareContext | null
  shareCanEdit: boolean
  shareCanUpload: boolean
  completeCodeMirrorPaste: (markdown: string | null) => boolean
}

async function rollbackUploadedImage(
  ctx: KbImagePasteContext,
  uploadedPath: string,
  rollbackId?: string,
): Promise<void> {
  if (ctx.shareContext) {
    if (!rollbackId) throw new Error('Share image upload did not return a rollback capability')
    await post(`/api/share/${ctx.shareContext.token}/cancel-image-upload`, {
      rollbackId,
    })
  } else {
    await post('/api/files/delete', { path: uploadedPath })
  }
}

async function finalizeShareImageUpload(
  ctx: KbImagePasteContext,
  rollbackId: string,
): Promise<void> {
  await post(`/api/share/${ctx.shareContext!.token}/finalize-image-upload`, { rollbackId })
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

/** Uploads an authorized clipboard image and completes insertion with Obsidian syntax. */
export async function tryPasteKnowledgeBaseImage(
  e: ClipboardEvent,
  ctx: KbImagePasteContext,
): Promise<boolean> {
  const normPath = ctx.viewingPath.replace(/\\/g, '/')
  if (!/\.md$/i.test(normPath)) return false
  const kbRoot = getKnowledgeBaseRoot(normPath, ctx.knowledgeBases)
  if (!kbRoot && !ctx.shareContext) return false

  const items = e.clipboardData?.items
  if (!items?.length) return false

  const imgItem = Array.from(items).find((it) => it.type.startsWith('image/'))
  if (!imgItem) return false

  const file = imgItem.getAsFile()
  if (!file) return false

  if (ctx.shareContext) {
    if (!ctx.shareCanEdit || !ctx.shareCanUpload) return false
  } else if (!kbRoot || !isPathEditable(`${kbRoot}/images`, ctx.editableFolders)) {
    return false
  }

  e.preventDefault()

  const mimeType = file.type || 'image/png'
  const preferredName = formatObsidianPastedImageFileName(mimeType)

  try {
    const base64 = await blobToBase64(file)
    let usedName: string
    let uploadedPath: string
    let rollbackId: string | undefined
    if (ctx.shareContext) {
      const res = await post<{
        success: boolean
        fileName: string
        path: string
        rollbackId: string
      }>(`/api/share/${ctx.shareContext.token}/upload-image`, {
        base64Content: base64,
        mimeType,
        fileName: preferredName,
      })
      usedName = res.fileName
      uploadedPath = res.path
      rollbackId = res.rollbackId
    } else {
      usedName = await createKbImageWithUniqueName(kbRoot!, preferredName, base64)
      uploadedPath = `${kbRoot}/images/${usedName}`
    }

    const target = ctx.shareContext
      ? kbRoot
        ? usedName
        : ctx.shareContext.isDirectory
          ? `${ctx.shareContext.sharePath.replace(/\\/g, '/').replace(/\/$/, '')}/images/${usedName}`
          : `images/${usedName}`
      : usedName
    const insert = `![[${target}]]`
    if (!ctx.completeCodeMirrorPaste(insert)) {
      try {
        await rollbackUploadedImage(ctx, uploadedPath, rollbackId)
      } catch (error) {
        console.error('Failed to roll back unused pasted image:', error)
      }
    } else if (ctx.shareContext && rollbackId) {
      try {
        await finalizeShareImageUpload(ctx, rollbackId)
      } catch (error) {
        console.error('Failed to finalize pasted share image:', error)
      }
    }
  } catch (e) {
    ctx.completeCodeMirrorPaste(null)
    window.alert(e instanceof Error ? e.message : 'Failed to save pasted image')
  }

  return true
}
