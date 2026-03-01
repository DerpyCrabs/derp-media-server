import { NextRequest, NextResponse } from 'next/server'
import { validateShareAccess } from '@/lib/share-access'
import { writeBinaryFile, isPathEditable } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import { getEffectiveRestrictions, checkUploadQuota, addShareUsedBytes } from '@/lib/shares'
import { getKnowledgeBaseRootForPath } from '@/lib/knowledge-base'
import path from 'path'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const result = await validateShareAccess(request, token)
    if (result instanceof NextResponse) return result
    const { share } = result

    if (!share.editable) {
      return NextResponse.json({ error: 'Share is not editable' }, { status: 403 })
    }

    const restrictions = getEffectiveRestrictions(share)
    if (!restrictions.allowUpload) {
      return NextResponse.json({ error: 'Uploads are not allowed for this share' }, { status: 403 })
    }

    const body = await request.json()
    const { base64Content, mimeType } = body

    if (!base64Content || typeof base64Content !== 'string') {
      return NextResponse.json({ error: 'base64Content is required' }, { status: 400 })
    }

    const contentSize = Math.ceil((base64Content.length * 3) / 4)
    const quota = checkUploadQuota(share, contentSize)
    if (!quota.allowed) {
      return NextResponse.json({ error: 'Upload quota exceeded for this share' }, { status: 413 })
    }

    const { getKnowledgeBases } = await import('@/lib/knowledge-base')
    const knowledgeBases = await getKnowledgeBases()

    const sharePath = share.path.replace(/\\/g, '/')
    const fileDir = path.dirname(sharePath).replace(/\\/g, '/')
    const kbRoot = getKnowledgeBaseRootForPath(sharePath, knowledgeBases)

    let imagesDir: string
    if (
      kbRoot &&
      share.isDirectory &&
      (sharePath === kbRoot || sharePath.startsWith(kbRoot + '/'))
    ) {
      imagesDir = `${kbRoot}/images`
    } else if (kbRoot) {
      imagesDir = `${kbRoot}/images`
    } else {
      imagesDir = `${fileDir}/images`
    }

    if (!isPathEditable(imagesDir)) {
      return NextResponse.json(
        { error: 'Images folder is not in an editable directory' },
        { status: 403 },
      )
    }

    const ext = (mimeType || 'image/png').split('/')[1] || 'png'
    const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png'
    const fileName = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
    const imagePath = `${imagesDir}/${fileName}`

    await writeBinaryFile(imagePath, base64Content)
    await addShareUsedBytes(token, contentSize)

    const parentDir = path.dirname(imagePath).replace(/\\/g, '/')
    broadcastFileChange(parentDir === '.' ? '' : parentDir)

    return NextResponse.json({ success: true, path: imagePath })
  } catch (error) {
    console.error('Error uploading image:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload image' },
      { status: 500 },
    )
  }
}
