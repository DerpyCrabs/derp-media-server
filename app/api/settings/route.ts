import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')

interface Settings {
  viewModes: Record<string, 'list' | 'grid'>
}

async function readSettings(): Promise<Settings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    // Return default settings if file doesn't exist
    return { viewModes: {} }
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
}

export async function GET(request: NextRequest) {
  try {
    const settings = await readSettings()
    const folderPath = request.nextUrl.searchParams.get('path') || ''
    const viewMode = settings.viewModes[folderPath] || 'list'

    return NextResponse.json({ viewMode })
  } catch (error) {
    console.error('Error reading settings:', error)
    return NextResponse.json({ viewMode: 'list' })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { path: folderPath, viewMode } = await request.json()

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
  } catch (error) {
    console.error('Error saving settings:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
