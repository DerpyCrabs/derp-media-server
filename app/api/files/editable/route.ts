import { NextRequest, NextResponse } from 'next/server'
import { isPathEditable, getEditableFolders } from '@/lib/file-system'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const path = searchParams.get('path')

    if (path) {
      // Check specific path
      const editable = isPathEditable(path)
      return NextResponse.json({ editable, path })
    } else {
      // Return list of editable folders
      const editableFolders = getEditableFolders()
      return NextResponse.json({ editableFolders })
    }
  } catch (error) {
    console.error('Error checking editable status:', error)
    return NextResponse.json({ error: 'Failed to check editable status' }, { status: 500 })
  }
}
