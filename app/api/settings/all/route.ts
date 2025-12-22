import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')

interface Settings {
  viewModes: Record<string, 'list' | 'grid'>
  favorites: string[]
}

async function readSettings(): Promise<Settings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return { viewModes: {}, favorites: [] }
  }
}

export async function GET() {
  try {
    const settings = await readSettings()
    return NextResponse.json(settings)
  } catch (error) {
    console.error('Error reading settings:', error)
    return NextResponse.json({ viewModes: {}, favorites: [] })
  }
}
