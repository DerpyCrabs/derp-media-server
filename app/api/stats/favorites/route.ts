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

async function readAllSettings(): Promise<SettingsFile> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

async function readSettings(): Promise<Settings> {
  const allSettings = await readAllSettings()
  return allSettings[config.mediaDir] || { favorites: [] }
}

async function writeSettings(settings: Settings): Promise<void> {
  const allSettings = await readAllSettings()
  allSettings[config.mediaDir] = settings
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(allSettings, null, 2), 'utf-8')
}

// GET - Get favorite files and folders
export async function GET() {
  try {
    const settings = await readSettings()
    const favorites = settings.favorites || []

    const fileItems: FileItem[] = []
    const stalePaths: string[] = []

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
      } catch {
        stalePaths.push(filePath)
        continue
      }
    }

    // Prune stale favorites from settings in the background
    if (stalePaths.length > 0) {
      const freshFavorites = favorites.filter((f: string) => !stalePaths.includes(f))
      writeSettings({ ...settings, favorites: freshFavorites }).catch(() => {})
    }

    return NextResponse.json({ files: fileItems })
  } catch (error) {
    console.error('Error reading favorites:', error)
    return NextResponse.json({ error: 'Failed to read favorites' }, { status: 500 })
  }
}
