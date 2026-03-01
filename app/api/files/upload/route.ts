import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { validatePath, isPathEditable } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const targetDir = (formData.get('targetDir') as string) || ''

    const files = formData.getAll('files') as File[]
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const broadcastDirs = new Set<string>()
    let uploadedCount = 0

    for (const file of files) {
      const relativePath = targetDir ? `${targetDir}/${file.name}` : file.name

      const parentDir = path.dirname(relativePath).replace(/\\/g, '/')
      const normalizedParent = parentDir === '.' ? '' : parentDir

      if (!isPathEditable(normalizedParent) && !isPathEditable(relativePath)) {
        continue
      }

      const fullPath = validatePath(relativePath)

      await fs.mkdir(path.dirname(fullPath), { recursive: true })

      const buffer = Buffer.from(await file.arrayBuffer())
      await fs.writeFile(fullPath, buffer)

      broadcastDirs.add(normalizedParent)
      uploadedCount++
    }

    if (uploadedCount === 0) {
      return NextResponse.json(
        { error: 'No files were uploaded — target path is not editable' },
        { status: 403 },
      )
    }

    broadcastDirs.forEach((dir) => broadcastFileChange(dir))

    return NextResponse.json({ success: true, uploaded: uploadedCount })
  } catch (error) {
    console.error('Error uploading files:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 },
    )
  }
}
