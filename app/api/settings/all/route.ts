import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import type { AutoSaveSettings } from '@/lib/types'
import { config } from '@/lib/config'
const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')

interface Settings {
  viewModes: Record<string, 'list' | 'grid'>
  favorites: string[]
  knowledgeBases: string[]
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
  const mediaDir = config.mediaDir
  return (
    allSettings[mediaDir] || {
      viewModes: {},
      favorites: [],
      knowledgeBases: [],
      customIcons: {},
      autoSave: {},
    }
  )
}

export async function GET() {
  try {
    const settings = await readSettings()
    return NextResponse.json(settings)
  } catch (error) {
    console.error('Error reading settings:', error)
    return NextResponse.json({
      viewModes: {},
      favorites: [],
      knowledgeBases: [],
      customIcons: {},
      autoSave: {},
    })
  }
}
