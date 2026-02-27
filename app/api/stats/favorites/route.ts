import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { getMediaType } from '@/lib/media-utils'
import { FileItem, MediaType } from '@/lib/types'
import { config } from '@/lib/config'
const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')

interface Settings {
  favorites?: string[]
}

interface SettingsFile {
  [mediaDir: string]: Settings
}

async function readSettings(): Promise<Settings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
    const allSettings: SettingsFile = JSON.parse(data)
    const mediaDir = config.mediaDir
    return allSettings[mediaDir] || { favorites: [] }
  } catch {
    return { favorites: [] }
  }
}

// GET - Get favorite files and folders
export async function GET() {
  try {
    const settings = await readSettings()
    const favorites = settings.favorites || []

    // Build FileItem array
    const fileItems: FileItem[] = []
    for (const filePath of favorites) {
      try {
        const fullPath = path.join(config.mediaDir, filePath)
        const stat = await fs.stat(fullPath)

        const fileName = path.basename(filePath)
        const extension = path.extname(fileName).slice(1).toLowerCase()

        fileItems.push({
          name: fileName,
          path: filePath,
          type: stat.isDirectory() ? MediaType.FOLDER : getMediaType(extension),
          size: stat.isDirectory() ? 0 : stat.size,
          extension,
          isDirectory: stat.isDirectory(),
        })
      } catch (error) {
        // Skip files that no longer exist or can't be accessed
        console.error(`Error accessing ${filePath}:`, error)
        continue
      }
    }

    return NextResponse.json({ files: fileItems })
  } catch (error) {
    console.error('Error reading favorites:', error)
    return NextResponse.json({ error: 'Failed to read favorites' }, { status: 500 })
  }
}
