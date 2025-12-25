import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import type { AutoSaveSettings } from '@/lib/types'

const MEDIA_DIR = process.env.MEDIA_DIR || process.cwd()
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
    return {}
  }
}

async function readSettings(): Promise<Settings> {
  const allSettings = await readAllSettings()
  return allSettings[MEDIA_DIR] || { viewModes: {}, favorites: [], customIcons: {}, autoSave: {} }
}

export async function GET() {
  try {
    const settings = await readSettings()
    return NextResponse.json(settings)
  } catch (error) {
    console.error('Error reading settings:', error)
    return NextResponse.json({ viewModes: {}, favorites: [], customIcons: {}, autoSave: {} })
  }
}
