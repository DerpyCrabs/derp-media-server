import { NextRequest, NextResponse } from 'next/server'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { listDirectory } from '@/lib/file-system'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const result = await validateShareAccess(request, token)
    if (result instanceof NextResponse) return result
    const { share } = result

    if (!share.isDirectory) {
      return NextResponse.json({ error: 'Share is not a directory' }, { status: 400 })
    }

    const subDir = request.nextUrl.searchParams.get('dir') || ''
    const resolved = resolveSharePath(share, subDir)
    if (resolved instanceof NextResponse) return resolved

    const allFiles = await listDirectory(resolved)

    // Filter out virtual folders from share listings
    const files = allFiles.filter((f) => !f.isVirtual)

    return NextResponse.json({ files })
  } catch (error) {
    console.error('Error listing share files:', error)
    return NextResponse.json({ error: 'Failed to list files' }, { status: 500 })
  }
}
