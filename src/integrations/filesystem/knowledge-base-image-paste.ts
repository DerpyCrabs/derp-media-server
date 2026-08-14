import { blobToBase64, formatObsidianPastedImageFileName } from '@/lib/pasted-kb-image'
import { getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'
import { createFilesystemFile, deleteFilesystemResource } from './actions'

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
  const match = /^(.+?)(\.[^.]+)$/.exec(baseName)
  const stem = match ? match[1]! : baseName
  const extension = match ? match[2]!.slice(1) : 'png'

  for (let index = 0; index < 100; index++) {
    const name = index === 0 ? baseName : `${stem}_${index}.${extension}`
    try {
      await createFilesystemFile(`${dir}/${name}`, { base64Content: base64 })
      return name
    } catch (error: unknown) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? (error as { status: number }).status
          : 0
      if (status === 409) continue
      throw error
    }
  }
  throw new Error('Could not find a free image file name')
}

export async function tryPasteKnowledgeBaseImage(
  event: ClipboardEvent,
  context: KbImagePasteContext,
): Promise<boolean> {
  const normalizedPath = context.viewingPath.replace(/\\/g, '/')
  if (!/\.md$/i.test(normalizedPath)) return false
  const knowledgeBaseRoot = getKnowledgeBaseRoot(normalizedPath, context.knowledgeBases)
  if (
    !knowledgeBaseRoot ||
    !isPathEditable(`${knowledgeBaseRoot}/images`, context.editableFolders)
  ) {
    return false
  }

  const items = event.clipboardData?.items
  if (!items?.length) return false
  const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'))
  const file = imageItem?.getAsFile()
  if (!file) return false

  event.preventDefault()
  const preferredName = formatObsidianPastedImageFileName(file.type || 'image/png')

  try {
    const base64 = await blobToBase64(file)
    const usedName = await createKbImageWithUniqueName(knowledgeBaseRoot, preferredName, base64)
    if (!context.completeCodeMirrorPaste(`![[${usedName}]]`)) {
      try {
        await deleteFilesystemResource(`${knowledgeBaseRoot}/images/${usedName}`)
      } catch (error) {
        console.error('Failed to roll back unused pasted image:', error)
      }
    }
  } catch (error) {
    context.completeCodeMirrorPaste(null)
    window.alert(error instanceof Error ? error.message : 'Failed to save pasted image')
  }

  return true
}
