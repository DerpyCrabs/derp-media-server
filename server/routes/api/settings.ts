import type { FastifyInstance } from 'fastify'
import { promises as fs } from 'fs'
import type { AutoSaveSettings } from '@/lib/types'
import { config, getDataFilePath } from '@/lib/config'
import { Mutex } from '@/lib/mutex'
import {
  filterAdminWorkspaceTaskbarPins,
  parseWorkspaceTaskbarPins,
  type WorkspaceTaskbarPin,
} from '@/lib/workspace-taskbar-pins'
import {
  parseWorkspaceLayoutPresetsList,
  sanitizeAdminWorkspaceLayoutPresets,
} from '@/lib/workspace-layout-presets-schema'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets-types'

const SETTINGS_FILE = getDataFilePath('settings.json')
const settingsMutex = new Mutex()

interface Settings {
  viewModes: Record<string, 'list' | 'grid'>
  favorites: string[]
  knowledgeBases: string[]
  customIcons: Record<string, string>
  autoSave: Record<string, AutoSaveSettings>
  workspaceTaskbarPins?: WorkspaceTaskbarPin[]
  workspaceLayoutPresets?: WorkspaceLayoutPreset[]
}

interface SettingsFile {
  [mediaDir: string]: Settings
}

const DEFAULT_SETTINGS: Settings = {
  viewModes: {},
  favorites: [],
  knowledgeBases: [],
  customIcons: {},
  autoSave: {},
  workspaceTaskbarPins: [],
  workspaceLayoutPresets: [],
}

async function readAllSettings(): Promise<SettingsFile> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function readSettings(): Promise<Settings> {
  const allSettings = await readAllSettings()
  const raw = allSettings[config.mediaDir] || { ...DEFAULT_SETTINGS }
  return {
    ...raw,
    workspaceTaskbarPins: filterAdminWorkspaceTaskbarPins(
      parseWorkspaceTaskbarPins(raw.workspaceTaskbarPins),
    ),
    workspaceLayoutPresets: sanitizeAdminWorkspaceLayoutPresets(
      parseWorkspaceLayoutPresetsList(raw.workspaceLayoutPresets),
    ),
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  const release = await settingsMutex.acquire()
  try {
    const allSettings = await readAllSettings()
    allSettings[config.mediaDir] = settings
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(allSettings, null, 2), 'utf-8')
  } finally {
    release()
  }
}

export function registerSettingsApiRoutes(app: FastifyInstance) {
  app.get('/api/settings', async (_request, reply) => {
    try {
      return reply.send(await readSettings())
    } catch {
      return reply.send({ ...DEFAULT_SETTINGS })
    }
  })

  app.post('/api/settings/viewMode', async (request, reply) => {
    const body = request.body as { path: string; viewMode: 'list' | 'grid' }

    const settings = await readSettings()
    settings.viewModes[body.path] = body.viewMode
    await writeSettings(settings)
    return reply.send({ success: true })
  })

  app.post('/api/settings/favorite', async (request, reply) => {
    const body = request.body as { filePath: string }

    if (!body.filePath) {
      return reply.code(400).send({ error: 'File path is required' })
    }

    const settings = await readSettings()
    if (!settings.favorites) settings.favorites = []

    const index = settings.favorites.indexOf(body.filePath)
    if (index > -1) {
      settings.favorites.splice(index, 1)
    } else {
      settings.favorites.push(body.filePath)
    }

    await writeSettings(settings)
    return reply.send({
      success: true,
      isFavorite: index === -1,
      favorites: settings.favorites,
    })
  })

  app.post('/api/settings/knowledgeBase', async (request, reply) => {
    const body = request.body as { filePath: string }

    if (!body.filePath) {
      return reply.code(400).send({ error: 'File path is required' })
    }

    const settings = await readSettings()
    if (!settings.knowledgeBases) settings.knowledgeBases = []

    const index = settings.knowledgeBases.indexOf(body.filePath)
    if (index > -1) {
      settings.knowledgeBases.splice(index, 1)
    } else {
      settings.knowledgeBases.push(body.filePath)
    }

    await writeSettings(settings)
    return reply.send({
      success: true,
      isKnowledgeBase: index === -1,
      knowledgeBases: settings.knowledgeBases,
    })
  })

  app.post('/api/settings/icon', async (request, reply) => {
    const body = request.body as { path: string; iconName: string }

    if (!body.iconName) {
      return reply.code(400).send({ error: 'Valid icon name is required' })
    }

    const settings = await readSettings()
    if (!settings.customIcons) settings.customIcons = {}

    settings.customIcons[body.path] = body.iconName
    await writeSettings(settings)
    return reply.send({ success: true, customIcons: settings.customIcons })
  })

  app.post('/api/settings/icon/remove', async (request, reply) => {
    const body = request.body as { path: string }

    const settings = await readSettings()
    if (!settings.customIcons) settings.customIcons = {}

    delete settings.customIcons[body.path]
    await writeSettings(settings)
    return reply.send({ success: true, customIcons: settings.customIcons })
  })

  app.post('/api/settings/autoSave', async (request, reply) => {
    const body = request.body as {
      filePath: string
      enabled: boolean
      readOnly?: boolean
    }

    if (!body.filePath) {
      return reply.code(400).send({ error: 'File path is required' })
    }

    const settings = await readSettings()
    if (!settings.autoSave) settings.autoSave = {}

    settings.autoSave[body.filePath] = {
      enabled: body.enabled,
      ...(body.readOnly !== undefined && { readOnly: body.readOnly }),
    }
    await writeSettings(settings)
    return reply.send({ success: true, autoSave: settings.autoSave })
  })

  app.post('/api/settings/workspaceTaskbarPins', async (request, reply) => {
    const body = request.body as { items?: unknown }
    const parsed = filterAdminWorkspaceTaskbarPins(parseWorkspaceTaskbarPins(body.items))
    const settings = await readSettings()
    settings.workspaceTaskbarPins = parsed
    await writeSettings(settings)
    return reply.send({ success: true, workspaceTaskbarPins: parsed })
  })

  app.post('/api/settings/workspaceLayoutPresets', async (request, reply) => {
    const body = request.body as { presets?: unknown }
    const parsed = sanitizeAdminWorkspaceLayoutPresets(
      parseWorkspaceLayoutPresetsList(body.presets),
    )
    const settings = await readSettings()
    settings.workspaceLayoutPresets = parsed
    await writeSettings(settings)
    return reply.send({ success: true, workspaceLayoutPresets: parsed })
  })
}
