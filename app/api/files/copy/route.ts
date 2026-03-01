import { NextRequest, NextResponse } from 'next/server'
import { copyFileOrDirectory } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sourcePath, destinationDir } = body

    if (!sourcePath || destinationDir === undefined) {
      return NextResponse.json(
        { error: 'Both sourcePath and destinationDir are required' },
        { status: 400 },
      )
    }

    await copyFileOrDirectory(sourcePath, String(destinationDir))
    const destParent = String(destinationDir).replace(/\\/g, '/')
    broadcastFileChange(destParent === '' ? '' : destParent)
    return NextResponse.json({ success: true, message: 'Copied successfully' })
  } catch (error) {
    console.error('Error copying:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to copy' },
      { status: 500 },
    )
  }
}
