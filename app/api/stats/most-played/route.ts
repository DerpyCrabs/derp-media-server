import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { getMediaType } from '@/lib/media-utils'
import { FileItem } from '@/lib/types'
import { config } from '@/lib/config'
const STATS_FILE = path.join(process.cwd(), 'stats.json')

interface ViewStats {
  views: Record<string, number>
}

interface StatsFile {
  [mediaDir: string]: ViewStats
}

async function readStats(): Promise<ViewStats> {
  try {
    const data = await fs.readFile(STATS_FILE, 'utf-8')
    const allStats: StatsFile = JSON.parse(data)
    const mediaDir = config.mediaDir
    return allStats[mediaDir] || { views: {} }
  } catch {
    return { views: {} }
  }
}

async function writeStats(stats: ViewStats): Promise<void> {
  const allStats = await readAllStats()
  allStats[config.mediaDir] = stats
  await fs.writeFile(STATS_FILE, JSON.stringify(allStats, null, 2), 'utf-8')
}

async function readAllStats(): Promise<StatsFile> {
  try {
    const data = await fs.readFile(STATS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

// GET - Get most played files
export async function GET() {
  try {
    const stats = await readStats()
    const views = stats.views || {}

    const sortedFiles = Object.entries(views)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50)

    const fileItems: FileItem[] = []
    const staleKeys: string[] = []

    for (const [filePath, viewCount] of sortedFiles) {
      try {
        const fullPath = path.join(config.mediaDir, filePath)
        const stat = await fs.stat(fullPath)

        if (stat.isDirectory()) {
          continue
        }

        const fileName = path.basename(filePath)
        const extension = path.extname(fileName).slice(1).toLowerCase()

        fileItems.push({
          name: fileName,
          path: filePath,
          type: getMediaType(extension),
          size: stat.size,
          extension,
          isDirectory: false,
          viewCount,
        })
      } catch {
        staleKeys.push(filePath)
        continue
      }
    }

    // Prune stale entries from stats in the background
    if (staleKeys.length > 0) {
      const freshViews = { ...views }
      for (const key of staleKeys) {
        delete freshViews[key]
      }
      writeStats({ ...stats, views: freshViews }).catch(() => {})
    }

    return NextResponse.json({ files: fileItems })
  } catch (error) {
    console.error('Error reading most played files:', error)
    return NextResponse.json({ error: 'Failed to read most played files' }, { status: 500 })
  }
}
