import { NextRequest, NextResponse } from 'next/server'
import { deleteDirectory } from '@/lib/file-system'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { path: relativePath } = body

    if (!relativePath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    await deleteDirectory(relativePath)
    return NextResponse.json({ success: true, message: 'Folder deleted' })
  } catch (error) {
    console.error('Error deleting folder:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete folder' },
      { status: 500 },
    )
  }
}
