import { NextRequest, NextResponse } from 'next/server'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { promises as fs } from 'fs'
import path from 'path'
import { config } from '@/lib/config'

const STATS_FILE = path.join(process.cwd(), 'stats.json')

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const result = await validateShareAccess(request, token)
    if (result instanceof NextResponse) return result
    const { share } = result

    const body = await request.json()
    const { filePath } = body

    let resolvedPath: string
    if (share.isDirectory && filePath) {
      const resolved = resolveSharePath(share, filePath)
      if (resolved instanceof NextResponse) return resolved
      resolvedPath = resolved
    } else {
      resolvedPath = share.path
    }

    let allStats: Record<
      string,
      { views: Record<string, number>; shareViews: Record<string, number> }
    > = {}
    try {
      const data = await fs.readFile(STATS_FILE, 'utf-8')
      allStats = JSON.parse(data)
    } catch {}

    const mediaDir = config.mediaDir
    if (!allStats[mediaDir]) {
      allStats[mediaDir] = { views: {}, shareViews: {} }
    }
    if (!allStats[mediaDir].shareViews) {
      allStats[mediaDir].shareViews = {}
    }

    allStats[mediaDir].shareViews[resolvedPath] =
      (allStats[mediaDir].shareViews[resolvedPath] || 0) + 1
    await fs.writeFile(STATS_FILE, JSON.stringify(allStats, null, 2), 'utf-8')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error tracking share view:', error)
    return NextResponse.json({ error: 'Failed to track view' }, { status: 500 })
  }
}
