import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { validatePath } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import { getEffectiveRestrictions, checkUploadQuota, addShareUsedBytes } from '@/lib/shares'
import { formatFileSize } from '@/lib/media-utils'

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

    const formData = await request.formData()
    const targetSubDir = (formData.get('targetDir') as string) || ''
    const files = formData.getAll('files') as File[]

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    // Fail-fast: sum all file sizes and check quota before writing anything
    let totalBytes = 0
    for (const file of files) {
      totalBytes += file.size
    }

    const quota = checkUploadQuota(share, totalBytes)
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: `Upload exceeds quota (${formatFileSize(quota.remaining)} remaining, ${formatFileSize(totalBytes)} requested)`,
          remaining: quota.remaining,
          requested: totalBytes,
        },
        { status: 413 },
      )
    }

    const broadcastDirs = new Set<string>()
    let uploadedCount = 0

    for (const file of files) {
      const subPath = targetSubDir ? `${targetSubDir}/${file.name}` : file.name

      const resolved = resolveSharePath(share, subPath)
      if (resolved instanceof NextResponse) continue

      const fullPath = validatePath(resolved)

      await fs.mkdir(path.dirname(fullPath), { recursive: true })

      const buffer = Buffer.from(await file.arrayBuffer())
      await fs.writeFile(fullPath, buffer)

      const parentDir = path.dirname(resolved).replace(/\\/g, '/')
      const normalizedParent = parentDir === '.' ? '' : parentDir
      broadcastDirs.add(normalizedParent)
      uploadedCount++
    }

    if (totalBytes > 0) {
      await addShareUsedBytes(token, totalBytes)
    }

    broadcastDirs.forEach((dir) => broadcastFileChange(dir))

    return NextResponse.json({ success: true, uploaded: uploadedCount })
  } catch (error) {
    console.error('Error uploading to share:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 },
    )
  }
}
