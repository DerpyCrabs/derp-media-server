import { NextRequest, NextResponse } from 'next/server'
import { renameFileOrDirectory } from '@/lib/file-system'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { oldPath, newPath } = body

    if (!oldPath || !newPath) {
      return NextResponse.json({ error: 'Both oldPath and newPath are required' }, { status: 400 })
    }

    await renameFileOrDirectory(oldPath, newPath)
    return NextResponse.json({ success: true, message: 'Renamed successfully' })
  } catch (error) {
    console.error('Error renaming:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rename' },
      { status: 500 },
    )
  }
}
