import { NextRequest, NextResponse } from 'next/server'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { createDirectory, writeFile, writeBinaryFile, fileExists } from '@/lib/file-system'

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

    const body = await request.json()
    const { type, path: subPath, content, base64Content } = body

    if (!subPath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    const resolved = resolveSharePath(share, subPath)
    if (resolved instanceof NextResponse) return resolved

    const exists = await fileExists(resolved)
    if (exists) {
      const itemType = type === 'folder' ? 'folder' : 'file'
      return NextResponse.json(
        { error: `A ${itemType} with this name already exists` },
        { status: 409 },
      )
    }

    if (type === 'folder') {
      await createDirectory(resolved)
      return NextResponse.json({ success: true, message: 'Folder created' })
    } else if (type === 'file') {
      if (content === undefined && base64Content === undefined) {
        return NextResponse.json({ error: 'Content is required for files' }, { status: 400 })
      }
      if (base64Content) {
        await writeBinaryFile(resolved, base64Content)
      } else {
        await writeFile(resolved, content)
      }
      return NextResponse.json({ success: true, message: 'File saved' })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    console.error('Error creating in share:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create' },
      { status: 500 },
    )
  }
}
