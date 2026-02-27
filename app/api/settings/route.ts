import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import type { AutoSaveSettings } from '@/lib/types'
import { config } from '@/lib/config'
const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')

interface Settings {
  viewModes: Record<string, 'list' | 'grid'>
  favorites: string[]
  customIcons: Record<string, string>
  autoSave: Record<string, AutoSaveSettings>
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
  const mediaDir = config.mediaDir
  return allSettings[mediaDir] || { viewModes: {}, favorites: [], customIcons: {}, autoSave: {} }
}

async function writeSettings(settings: Settings): Promise<void> {
  const allSettings = await readAllSettings()
  allSettings[config.mediaDir] = settings
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(allSettings, null, 2), 'utf-8')
}

export async function GET(request: NextRequest) {
  try {
    const settings = await readSettings()
    const folderPath = request.nextUrl.searchParams.get('path') || ''
    const viewMode = settings.viewModes[folderPath] || 'list'

    return NextResponse.json({
      viewMode,
      favorites: settings.favorites || [],
      customIcons: settings.customIcons || {},
      autoSave: settings.autoSave || {},
    })
  } catch (error) {
    console.error('Error reading settings:', error)
    return NextResponse.json({ viewMode: 'list', favorites: [], customIcons: {}, autoSave: {} })
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

    // Handle custom icon set
    if ('action' in body && body.action === 'setCustomIcon') {
      const { path: itemPath, iconName } = body

      if (!itemPath && itemPath !== '') {
        return NextResponse.json({ error: 'Path is required' }, { status: 400 })
      }

      if (!iconName || typeof iconName !== 'string') {
        return NextResponse.json({ error: 'Valid icon name is required' }, { status: 400 })
      }

      const settings = await readSettings()
      if (!settings.customIcons) {
        settings.customIcons = {}
      }

      settings.customIcons[itemPath] = iconName
      await writeSettings(settings)

      return NextResponse.json({
        success: true,
        customIcons: settings.customIcons,
      })
    }

    // Handle custom icon removal
    if ('action' in body && body.action === 'removeCustomIcon') {
      const { path: itemPath } = body

      if (!itemPath && itemPath !== '') {
        return NextResponse.json({ error: 'Path is required' }, { status: 400 })
      }

      const settings = await readSettings()
      if (!settings.customIcons) {
        settings.customIcons = {}
      }

      delete settings.customIcons[itemPath]
      await writeSettings(settings)

      return NextResponse.json({
        success: true,
        customIcons: settings.customIcons,
      })
    }

    // Handle auto-save setting
    if ('action' in body && body.action === 'setAutoSave') {
      const { filePath, enabled, readOnly } = body

      if (!filePath) {
        return NextResponse.json({ error: 'File path is required' }, { status: 400 })
      }

      if (typeof enabled !== 'boolean') {
        return NextResponse.json({ error: 'Enabled must be a boolean' }, { status: 400 })
      }

      const settings = await readSettings()
      if (!settings.autoSave) {
        settings.autoSave = {}
      }

      settings.autoSave[filePath] = {
        enabled,
        ...(readOnly !== undefined && { readOnly }),
      }
      await writeSettings(settings)

      return NextResponse.json({
        success: true,
        autoSave: settings.autoSave,
      })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    console.error('Error saving settings:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
