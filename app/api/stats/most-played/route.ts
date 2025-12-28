import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { getMediaType } from '@/lib/media-utils'
import { FileItem, MediaType } from '@/lib/types'

const MEDIA_DIR = process.env.MEDIA_DIR || process.cwd()
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
    return allStats[MEDIA_DIR] || { views: {} }
  } catch {
    return { views: {} }
  }
}

// GET - Get most played files
export async function GET() {
  try {
    const stats = await readStats()
    const views = stats.views || {}

    // Sort files by view count (descending)
    const sortedFiles = Object.entries(views)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50) // Limit to top 50

    // Build FileItem array
    const fileItems: FileItem[] = []
    for (const [filePath, viewCount] of sortedFiles) {
      try {
        const fullPath = path.join(MEDIA_DIR, filePath)
        const stat = await fs.stat(fullPath)

        // Skip directories
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
      } catch (error) {
        // Skip files that no longer exist or can't be accessed
        console.error(`Error accessing ${filePath}:`, error)
        continue
      }
    }

    return NextResponse.json({ files: fileItems })
  } catch (error) {
    console.error('Error reading most played files:', error)
    return NextResponse.json({ error: 'Failed to read most played files' }, { status: 500 })
  }
}
