import { NextRequest, NextResponse } from 'next/server'
import { listDirectory } from '@/lib/file-system'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const dir = searchParams.get('dir') || ''
    
    const files = await listDirectory(dir)
    
    return NextResponse.json({ files })
  } catch (error) {
    console.error('Error listing files:', error)
    return NextResponse.json(
      { error: 'Failed to list files' },
      { status: 500 }
    )
  }
}

