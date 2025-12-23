import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const MEDIA_DIR = process.env.MEDIA_DIR || process.cwd()
const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')

interface Settings {
  viewModes: Record<string, 'list' | 'grid'>
  favorites: string[]
}

interface SettingsFile {
  [mediaDir: string]: Settings
}

async function readAllSettings(): Promise<SettingsFile> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    // Return empty settings file if it doesn't exist
    return {}
  }
}

async function readSettings(): Promise<Settings> {
  const allSettings = await readAllSettings()
  return allSettings[MEDIA_DIR] || { viewModes: {}, favorites: [] }
}

async function writeSettings(settings: Settings): Promise<void> {
  const allSettings = await readAllSettings()
  allSettings[MEDIA_DIR] = settings
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(allSettings, null, 2), 'utf-8')
}

export async function GET(request: NextRequest) {
  try {
    const settings = await readSettings()
    const folderPath = request.nextUrl.searchParams.get('path') || ''
    const viewMode = settings.viewModes[folderPath] || 'list'

    return NextResponse.json({ viewMode, favorites: settings.favorites || [] })
  } catch (error) {
    console.error('Error reading settings:', error)
    return NextResponse.json({ viewMode: 'list', favorites: [] })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Handle view mode changes
    if ('viewMode' in body) {
      const { path: folderPath, viewMode } = body

      if (!folderPath && folderPath !== '') {
        return NextResponse.json({ error: 'Path is required' }, { status: 400 })
      }

      if (viewMode !== 'list' && viewMode !== 'grid') {
        return NextResponse.json({ error: 'Invalid view mode' }, { status: 400 })
      }

      const settings = await readSettings()
      settings.viewModes[folderPath] = viewMode
      await writeSettings(settings)

      return NextResponse.json({ success: true })
    }

    // Handle favorite toggles
    if ('action' in body && body.action === 'toggleFavorite') {
      const { filePath } = body

      if (!filePath) {
        return NextResponse.json({ error: 'File path is required' }, { status: 400 })
      }

      const settings = await readSettings()
      if (!settings.favorites) {
        settings.favorites = []
      }

      const index = settings.favorites.indexOf(filePath)
      if (index > -1) {
        // Remove from favorites
        settings.favorites.splice(index, 1)
      } else {
        // Add to favorites
        settings.favorites.push(filePath)
      }

      await writeSettings(settings)

      return NextResponse.json({
        success: true,
        isFavorite: index === -1,
        favorites: settings.favorites,
      })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    console.error('Error saving settings:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
