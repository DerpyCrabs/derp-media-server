import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { config } from '@/lib/config'
const STATS_FILE = path.join(process.cwd(), 'stats.json')

interface ViewStats {
  views: Record<string, number>
  shareViews: Record<string, number>
}

interface StatsFile {
  [mediaDir: string]: ViewStats
}

async function readAllStats(): Promise<StatsFile> {
  try {
    const data = await fs.readFile(STATS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    // Return empty stats file if it doesn't exist
    return {}
  }
}

async function readStats(): Promise<ViewStats> {
  const allStats = await readAllStats()
  const mediaDir = config.mediaDir
  return allStats[mediaDir] || { views: {}, shareViews: {} }
}

async function writeStats(stats: ViewStats): Promise<void> {
  const allStats = await readAllStats()
  allStats[config.mediaDir] = stats
  await fs.writeFile(STATS_FILE, JSON.stringify(allStats, null, 2), 'utf-8')
}

// GET - Get all view counts
export async function GET() {
  try {
    const stats = await readStats()
    return NextResponse.json({ views: stats.views || {}, shareViews: stats.shareViews || {} })
  } catch (error) {
    console.error('Error reading stats:', error)
    return NextResponse.json({ views: {}, shareViews: {} })
  }
}

// POST - Increment view count for a file
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { filePath } = body

    if (!filePath) {
      return NextResponse.json({ error: 'File path is required' }, { status: 400 })
    }

    const stats = await readStats()
    if (!stats.views) {
      stats.views = {}
    }

    // Increment view count
    stats.views[filePath] = (stats.views[filePath] || 0) + 1
    await writeStats(stats)

    return NextResponse.json({
      success: true,
      viewCount: stats.views[filePath],
    })
  } catch (error) {
    console.error('Error updating view stats:', error)
    return NextResponse.json({ error: 'Failed to update view stats' }, { status: 500 })
  }
}
