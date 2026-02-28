import { NextRequest, NextResponse } from 'next/server'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { writeFile, writeBinaryFile } from '@/lib/file-system'

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
    const { path: subPath, content, base64Content } = body

    if (!subPath && subPath !== '') {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    const resolved = resolveSharePath(share, subPath)
    if (resolved instanceof NextResponse) return resolved

    if (content === undefined && base64Content === undefined) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    if (base64Content) {
      await writeBinaryFile(resolved, base64Content)
    } else {
      await writeFile(resolved, content)
    }

    return NextResponse.json({ success: true, message: 'File saved' })
  } catch (error) {
    console.error('Error editing shared file:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save file' },
      { status: 500 },
    )
  }
}
