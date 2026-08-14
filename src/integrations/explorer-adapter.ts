import { FILESYSTEM_PROVIDER, type ResourceKey, type ResourceSummary } from '@/lib/domain/resource'
import type { ContentInstance } from '@/lib/domain/content'
import { MediaType, type FileItem } from '@/lib/types'
import { apiEndpoints, type StatsResponse } from '@/lib/api-endpoints'
import { api } from '@/lib/api'
import { adaptFileItemResource } from '@/lib/domain/file-item-resource'
import type { ServerConfigDto, SettingsDto } from '@/lib/generated/api-contracts'
import type { Accessor } from 'solid-js'
import {
  createRegistryExplorerDataSource,
  registryExplorerItem,
  type RegistryExplorerPayload,
} from '@/src/features/explorer/registry-data-source'
import type {
  ExplorerDataSource,
  ExplorerItem,
  ExplorerLocation,
  ExplorerPage,
  ExplorerSearchResult,
} from '@/src/features/explorer/types'
import { getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import { buildAdminMediaUrl } from '@/src/lib/build-media-url'
import { subscribeSseAdmin } from '@/src/lib/sse-shared-worker-client'
import {
  filesystemLegacyPathForResourceKey,
  legacyFilesystemResourceKey,
} from './filesystem/module'
import { hermesLegacyPathForResourceKey, hermesResourceKeyFromLegacyPath } from './hermes/module'
import { applicationContentRegistry } from './registry'

export type ApplicationExplorerPayload = RegistryExplorerPayload

const applicationExplorerListeners = new Set<() => void>()
let applicationExplorerStats: StatsResponse | null = null
let applicationExplorerSettingsGeneration = 0
let applicationExplorerSseUnsubscribe: (() => void) | null = null

function notifyApplicationExplorers() {
  for (const listener of applicationExplorerListeners) listener()
}

function ensureApplicationExplorerEvents() {
  if (applicationExplorerSseUnsubscribe || typeof window === 'undefined') return
  applicationExplorerSseUnsubscribe = subscribeSseAdmin((event) => {
    if (event.type === 'connected') return
    if (event.type === 'settings-changed') applicationExplorerSettingsGeneration += 1
    notifyApplicationExplorers()
  })
}

function releaseApplicationExplorerEventsIfIdle() {
  if (applicationExplorerListeners.size > 0) return
  applicationExplorerSseUnsubscribe?.()
  applicationExplorerSseUnsubscribe = null
}

async function loadApplicationExplorerStats(): Promise<StatsResponse | null> {
  if (applicationExplorerStats) return applicationExplorerStats
  try {
    applicationExplorerStats = await apiEndpoints.stats.get()
  } catch {
    applicationExplorerStats = null
  }
  return applicationExplorerStats
}

function operation(id: string): string {
  return id.split(/[.:/]/).at(-1)?.toLowerCase() ?? id.toLowerCase()
}

function filesystemActionAllowed(
  actionId: string,
  path: string,
  editableFolders: readonly string[],
): boolean {
  switch (operation(actionId)) {
    case 'rename':
    case 'delete':
    case 'move':
      return isPathEditable(path, [...editableFolders])
    case 'copy':
      return editableFolders.length > 0
    case 'create':
    case 'createfile':
    case 'createfolder':
    case 'upload':
    case 'paste':
      return isPathEditable(path, [...editableFolders])
    default:
      return true
  }
}

function filterFilesystemItem(
  item: ExplorerItem<ApplicationExplorerPayload>,
  editableFolders: readonly string[],
): ExplorerItem<ApplicationExplorerPayload> {
  const path = filesystemLegacyPathForResourceKey(item.resource.key)
  if (path === null) return item
  const actions = item.actions.filter((action) =>
    filesystemActionAllowed(action.id, path, editableFolders),
  )
  const allowedCapabilities = new Set(actions.map((action) => action.capability))
  const capabilities = item.resource.capabilities.filter(
    (capability) => !capability.startsWith('filesystem.') || allowedCapabilities.has(capability),
  )
  const resource = {
    ...item.resource,
    capabilities,
    metadata: { ...item.resource.metadata, editableFolders: [...editableFolders] },
  }
  return { ...item, resource, actions, payload: { resource } }
}

function filterFilesystemPage(
  page: ExplorerPage<ApplicationExplorerPayload>,
  editableFolders: readonly string[],
): ExplorerPage<ApplicationExplorerPayload> {
  const items = page.items.map((item) => filterFilesystemItem(item, editableFolders))
  const locationItem = page.locationItem
    ? filterFilesystemItem(page.locationItem, editableFolders)
    : undefined
  const breadcrumbs = page.breadcrumbs.map((breadcrumb) => ({
    ...breadcrumb,
    ...(breadcrumb.item ? { item: filterFilesystemItem(breadcrumb.item, editableFolders) } : {}),
  }))
  return {
    ...page,
    items,
    breadcrumbs,
    ...(locationItem ? { locationItem, actions: locationItem.actions } : {}),
  }
}

function settingActions(
  item: ExplorerItem<ApplicationExplorerPayload>,
  settings: SettingsDto | null,
): ExplorerItem<ApplicationExplorerPayload> {
  const path = filesystemLegacyPathForResourceKey(item.resource.key)
  if (path === null || !settings) return item
  const metadata = item.resource.metadata ?? {}
  const isDirectory = metadata.isDirectory === true || item.resource.presentation === 'browse'
  const normalized = path.replace(/\\/g, '/')
  const favorite = settings.favorites.some(
    (candidate) => candidate.replace(/\\/g, '/') === normalized,
  )
  const knowledgeBase = settings.knowledgeBases.some(
    (candidate) => candidate.replace(/\\/g, '/') === normalized,
  )
  const customIcon = settings.customIcons[path] ?? settings.customIcons[normalized]
  const actions = [
    ...item.actions,
    {
      id: 'application.favorite',
      label: favorite ? 'Unfavorite' : 'Favorite',
      capability: 'settings.favorite',
      scope: 'resource' as const,
      interaction: 'immediate' as const,
    },
    ...(isDirectory
      ? [
          {
            id: 'application.knowledgeBase',
            label: knowledgeBase ? 'Remove Knowledge Base' : 'Set as Knowledge Base',
            capability: 'settings.knowledgeBase',
            scope: 'resource' as const,
            interaction: 'immediate' as const,
          },
          {
            id: 'application.customIcon',
            label: 'Set icon',
            capability: 'settings.customIcon',
            scope: 'resource' as const,
            interaction: 'appearance' as const,
            form: {
              kind: 'appearance',
              title: 'Set Custom Icon',
              submitLabel: 'Save',
              icons: ['Folder', 'Star', 'BookOpen', 'Archive', 'Image', 'Music', 'Video'],
            } as const,
          },
        ]
      : []),
  ]
  const resource: ResourceSummary = {
    ...item.resource,
    capabilities: [
      ...item.resource.capabilities,
      'settings.favorite',
      ...(isDirectory ? ['settings.knowledgeBase', 'settings.customIcon'] : []),
    ],
    metadata: {
      ...metadata,
      favorite,
      knowledgeBase,
      ...(customIcon ? { customIcon } : {}),
    },
  }
  return { ...item, resource, actions, payload: { resource } }
}

function settingPage(
  page: ExplorerPage<ApplicationExplorerPayload>,
  settings: SettingsDto | null,
): ExplorerPage<ApplicationExplorerPayload> {
  const items = page.items.map((item) => settingActions(item, settings))
  const locationItem = page.locationItem ? settingActions(page.locationItem, settings) : undefined
  const breadcrumbs = page.breadcrumbs.map((breadcrumb) => ({
    ...breadcrumb,
    ...(breadcrumb.item ? { item: settingActions(breadcrumb.item, settings) } : {}),
  }))
  return {
    ...page,
    items,
    breadcrumbs,
    ...(locationItem ? { locationItem, actions: locationItem.actions } : {}),
  }
}

function viewCountPage(
  page: ExplorerPage<ApplicationExplorerPayload>,
  stats: StatsResponse | null,
): ExplorerPage<ApplicationExplorerPayload> {
  if (!stats) return page
  const adaptItem = (item: ExplorerItem<ApplicationExplorerPayload>) => {
    const path = filesystemLegacyPathForResourceKey(item.resource.key)
    const viewCount = path === null ? undefined : stats.views[path]
    if (viewCount === undefined) return item
    const resource = {
      ...item.resource,
      metadata: { ...item.resource.metadata, viewCount },
    }
    return { ...item, resource, payload: { resource } }
  }
  return { ...page, items: page.items.map(adaptItem) }
}

function integrationActionForms(
  page: ExplorerPage<ApplicationExplorerPayload>,
): ExplorerPage<ApplicationExplorerPayload> {
  if (filesystemLegacyPathForResourceKey(page.location.key) !== null) return page
  const projectChoices = page.items
    .filter((item) => item.actions.some((action) => operation(action.id) === 'addprojectfolder'))
    .map((item) => ({ label: item.resource.name, value: item.resource.name }))
  const adaptAction = (action: ExplorerItem<ApplicationExplorerPayload>['actions'][number]) => {
    switch (operation(action.id)) {
      case 'createfolder':
        return {
          ...action,
          label: 'Create new project',
          form: { kind: 'project', title: 'Create Hermes project', submitLabel: 'Create' } as const,
        }
      case 'createfile':
        return { ...action, label: 'Create new session' }
      case 'movetoproject':
        return {
          ...action,
          form: {
            kind: 'choice',
            title: 'Move to Hermes project',
            submitLabel: 'Move',
            choices: projectChoices,
          } as const,
        }
      case 'setappearance':
        return {
          ...action,
          form: {
            kind: 'appearance',
            title: 'Project appearance',
            submitLabel: 'Save',
            icons: ['Folder', 'Star', 'Archive', 'Bot', 'MessageSquare'],
          } as const,
        }
      default:
        return action
    }
  }
  const adaptItem = (item: ExplorerItem<ApplicationExplorerPayload>) => ({
    ...item,
    actions: item.actions.map(adaptAction),
  })
  const items = page.items.map(adaptItem)
  const locationItem = page.locationItem ? adaptItem(page.locationItem) : undefined
  const breadcrumbs = page.breadcrumbs.map((breadcrumb) => ({
    ...breadcrumb,
    ...(breadcrumb.item ? { item: adaptItem(breadcrumb.item) } : {}),
  }))
  return {
    ...page,
    items,
    breadcrumbs,
    ...(locationItem ? { locationItem, actions: locationItem.actions } : {}),
  }
}

type KnowledgeBaseSearchResult = Readonly<{ path: string; name: string; snippet?: string }>
type KnowledgeBaseRecentResult = Readonly<{ path: string; name: string; modifiedAt?: string }>

function knowledgeBaseItem(
  value: Readonly<{ path: string; name: string }>,
  settings: SettingsDto | null,
): ExplorerItem<ApplicationExplorerPayload> {
  const type = getMediaTypeFromPath(value.path)
  const extension = value.name.includes('.') ? (value.name.split('.').at(-1) ?? '') : ''
  const file: FileItem = {
    path: value.path,
    name: value.name,
    type,
    extension,
    size: 0,
    isDirectory: false,
  }
  const base = adaptFileItemResource(file).resource
  const resource: ResourceSummary = {
    ...base,
    metadata: { fileType: type, extension, isDirectory: false },
  }
  return settingActions(
    registryExplorerItem(applicationContentRegistry, resource, 'resource'),
    settings,
  )
}

export function createApplicationExplorerDataSource(
  options: {
    editableFolders?: Accessor<readonly string[]>
    knowledgeBases?: Accessor<readonly string[]>
  } = {},
): ExplorerDataSource<ApplicationExplorerPayload> {
  const registrySource = createRegistryExplorerDataSource(applicationContentRegistry)
  let settings: SettingsDto | null = null
  let loadedSettingsGeneration = -1
  let serverConfig: ServerConfigDto | null = null

  async function loadSettings(): Promise<SettingsDto | null> {
    if (settings && loadedSettingsGeneration === applicationExplorerSettingsGeneration) {
      return settings
    }
    try {
      settings = await apiEndpoints.settings.get()
      loadedSettingsGeneration = applicationExplorerSettingsGeneration
    } catch {
      settings = null
    }
    return settings
  }

  async function loadServerConfig(): Promise<ServerConfigDto | null> {
    if (serverConfig) return serverConfig
    try {
      serverConfig = await apiEndpoints.config.get()
    } catch {
      serverConfig = null
    }
    return serverConfig
  }

  function commandInput(command: Parameters<typeof registrySource.execute>[0]): unknown {
    const path = filesystemLegacyPathForResourceKey(command.item.resource.key)
    if (path === null || typeof command.input !== 'object' || command.input === null) {
      return command.input
    }
    const input = command.input as Record<string, unknown>
    const action = operation(command.action.id)
    if (action === 'createfile') {
      return {
        ...input,
        content: typeof input.content === 'string' ? input.content : '',
      }
    }
    if (action === 'upload' && Array.isArray(input.files)) {
      const files = input.files.filter((file): file is File => file instanceof File)
      const formData = new FormData()
      formData.append('targetDir', path)
      for (const file of files) formData.append('files', file, file.name)
      return formData
    }
    if (action === 'paste' && typeof input.name === 'string') {
      return {
        ...input,
        path: [path, input.name].filter(Boolean).join('/'),
      }
    }
    if (action === 'rename' && typeof input.name === 'string') {
      const parent = path.split('/').slice(0, -1).join('/')
      return { ...input, newPath: [parent, input.name].filter(Boolean).join('/') }
    }
    if (action === 'copy' || action === 'move') {
      const destination =
        typeof input.destination === 'string'
          ? input.destination
          : typeof input.destination === 'object' && input.destination !== null
            ? filesystemLegacyPathForResourceKey(input.destination as ResourceKey)
            : null
      if (destination === null) return input
      if (action === 'copy') return { ...input, destinationDir: destination }
      const name = path.split('/').at(-1) ?? ''
      return {
        ...input,
        destinationDir: destination,
        newPath: [destination, name].filter(Boolean).join('/'),
      }
    }
    return input
  }

  return {
    async browse(request) {
      const [page, currentSettings, currentConfig, currentStats] = await Promise.all([
        registrySource.browse(request),
        loadSettings(),
        options.editableFolders ? Promise.resolve(null) : loadServerConfig(),
        loadApplicationExplorerStats(),
      ])
      const editableFolders = options.editableFolders?.() ?? currentConfig?.editableFolders ?? []
      const filtered = integrationActionForms(
        settingPage(
          filterFilesystemPage(viewCountPage(page, currentStats), editableFolders),
          currentSettings,
        ),
      )
      const path = filesystemLegacyPathForResourceKey(filtered.location.key)
      const preferredViewMode =
        path !== null && currentSettings ? currentSettings.viewModes[path] : undefined
      const withViewMode = preferredViewMode ? { ...filtered, preferredViewMode } : filtered
      const knowledgeBases = currentSettings?.knowledgeBases ?? [
        ...(options.knowledgeBases?.() ?? []),
      ]
      const knowledgeBaseRoot =
        path === null ? null : getKnowledgeBaseRoot(path, [...knowledgeBases])
      if (!knowledgeBaseRoot) return withViewMode
      let recentItems: ExplorerPage<ApplicationExplorerPayload>['recentItems'] = []
      try {
        const recent = await api<{ results: KnowledgeBaseRecentResult[] }>(
          `/api/kb/recent?root=${encodeURIComponent(knowledgeBaseRoot)}`,
          { signal: request.signal },
        )
        recentItems = recent.results.map((value) => ({
          item: knowledgeBaseItem(value, currentSettings),
          ...(value.modifiedAt ? { modifiedAt: value.modifiedAt } : {}),
        }))
      } catch {
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      }
      return {
        ...withViewMode,
        defaultFileExtension: 'md',
        contentSearch: {
          label: 'Search note contents',
          placeholder: 'Search notes...',
        },
        recentItems,
      }
    },
    async search(request): Promise<readonly ExplorerSearchResult<ApplicationExplorerPayload>[]> {
      const path = filesystemLegacyPathForResourceKey(request.location.key)
      if (path === null || !request.query.trim()) return []
      const currentSettings = await loadSettings()
      const knowledgeBases = currentSettings?.knowledgeBases ?? [
        ...(options.knowledgeBases?.() ?? []),
      ]
      const root = getKnowledgeBaseRoot(path, [...knowledgeBases])
      if (!root) return []
      const response = await api<{ results: KnowledgeBaseSearchResult[] }>(
        `/api/kb/search?root=${encodeURIComponent(root)}&q=${encodeURIComponent(request.query)}`,
        { signal: request.signal },
      )
      return response.results.map((value) => ({
        item: knowledgeBaseItem(value, currentSettings),
        ...(value.snippet ? { snippet: value.snippet } : {}),
      }))
    },
    async preview(item, signal) {
      const path = filesystemLegacyPathForResourceKey(item.resource.key)
      if (path === null) return {}
      const response = await fetch(buildAdminMediaUrl(path), { signal })
      if (!response.ok) throw new Error(`Preview failed: ${response.status}`)
      const metadata = item.resource.metadata ?? {}
      return {
        text: await response.text(),
        ...(item.resource.mime ? { mime: item.resource.mime } : {}),
        ...(item.resource.size === undefined ? {} : { size: item.resource.size }),
        ...(typeof metadata.version === 'number' ? { version: metadata.version } : {}),
      }
    },
    async execute(command, signal) {
      const path = filesystemLegacyPathForResourceKey(command.item.resource.key)
      if (path !== null && command.action.id === 'application.favorite') {
        await apiEndpoints.settings.toggleFavorite({ filePath: path })
        settings = await apiEndpoints.settings.get()
        loadedSettingsGeneration = applicationExplorerSettingsGeneration
        notifyApplicationExplorers()
        return { commandId: command.id, affectedResources: [command.item.resource.key] }
      }
      if (path !== null && command.action.id === 'application.knowledgeBase') {
        await apiEndpoints.settings.toggleKnowledgeBase({ filePath: path })
        settings = await apiEndpoints.settings.get()
        loadedSettingsGeneration = applicationExplorerSettingsGeneration
        notifyApplicationExplorers()
        return { commandId: command.id, affectedResources: [command.item.resource.key] }
      }
      if (path !== null && command.action.id === 'application.customIcon') {
        const input = command.input as { name?: unknown; metadata?: { icon?: unknown } } | undefined
        const candidate = input?.metadata?.icon ?? input?.name
        const name = typeof candidate === 'string' ? candidate.trim() : ''
        if (name) await apiEndpoints.settings.setCustomIcon({ path, iconName: name })
        else await apiEndpoints.settings.removeCustomIcon({ path })
        settings = await apiEndpoints.settings.get()
        loadedSettingsGeneration = applicationExplorerSettingsGeneration
        notifyApplicationExplorers()
        return { commandId: command.id, affectedResources: [command.item.resource.key] }
      }
      const receipt = await registrySource.execute(
        { ...command, input: commandInput(command) },
        signal,
      )
      notifyApplicationExplorers()
      return receipt
    },
    async persistState(location, state) {
      const path = filesystemLegacyPathForResourceKey(location.key)
      if (path === null || !state.viewMode || settings?.viewModes[path] === state.viewMode) return
      await apiEndpoints.settings.setViewMode({ path, viewMode: state.viewMode })
      if (settings)
        settings = { ...settings, viewModes: { ...settings.viewModes, [path]: state.viewMode } }
    },
    subscribe(listener) {
      applicationExplorerListeners.add(listener)
      ensureApplicationExplorerEvents()
      return () => {
        applicationExplorerListeners.delete(listener)
        releaseApplicationExplorerEventsIfIdle()
      }
    },
  }
}

export function legacyExplorerLocation(path: string): ExplorerLocation {
  return {
    key: hermesResourceKeyFromLegacyPath(path) ?? legacyFilesystemResourceKey(path),
  }
}

export function legacyExplorerPath(key: ResourceKey): string | null {
  return filesystemLegacyPathForResourceKey(key) ?? hermesLegacyPathForResourceKey(key)
}

export function legacyFilesystemExplorerPath(key: ResourceKey): string | null {
  return filesystemLegacyPathForResourceKey(key)
}

export async function recordApplicationExplorerView(resource: ResourceSummary): Promise<void> {
  const path = filesystemLegacyPathForResourceKey(resource.key)
  if (path === null || resource.capabilities.includes('browse')) return
  const result = await apiEndpoints.stats.addView(path)
  applicationExplorerStats = {
    views: { ...(applicationExplorerStats?.views ?? {}), [path]: result.viewCount },
  }
  notifyApplicationExplorers()
}

export async function moveLegacyFilesystemItem(
  sourcePath: string,
  destination: ResourceSummary,
): Promise<boolean> {
  const destinationPath = filesystemLegacyPathForResourceKey(destination.key)
  if (destinationPath === null) return false
  const name = sourcePath.split(/[/\\]/).at(-1) ?? ''
  const resource: ResourceSummary = {
    key: legacyFilesystemResourceKey(sourcePath),
    name,
    kind: 'file',
    capabilities: ['filesystem.move'],
  }
  const provider = applicationContentRegistry.actions(resource)
  const action = provider?.list(resource).find((candidate) => operation(candidate.id) === 'move')
  if (!provider || !action) return false
  const outcome = await provider.run({
    actionId: action.id,
    resource,
    input: { destinationDir: destinationPath },
  })
  if (outcome && 'schemaVersion' in outcome && 'code' in outcome) throw outcome
  notifyApplicationExplorers()
  return true
}

export async function openLegacyApplicationResource(
  path: string,
  name: string,
): Promise<ContentInstance | null> {
  const key = legacyExplorerLocation(path).key
  const resource: ResourceSummary = {
    key,
    name,
    kind: 'resource',
    capabilities: ['read', `${key.provider}.open`],
  }
  const provider = applicationContentRegistry.actions(resource)
  const action = provider?.list(resource).find((candidate) => operation(candidate.id) === 'open')
  if (!provider || !action) return null
  const outcome = await provider.run({ actionId: action.id, resource })
  if (outcome && 'schemaVersion' in outcome && 'code' in outcome) throw outcome
  return outcome?.content ?? null
}

function mediaType(resource: ResourceSummary): FileItem['type'] {
  if (resource.capabilities.includes('browse') || resource.presentation === 'browse') {
    return MediaType.FOLDER
  }
  switch (resource.presentation) {
    case 'video':
      return MediaType.VIDEO
    case 'audio':
      return MediaType.AUDIO
    case 'image':
      return MediaType.IMAGE
    case 'text':
      return MediaType.TEXT
    case 'pdf':
      return MediaType.PDF
    case 'book':
      return MediaType.BOOK
    default:
      return MediaType.OTHER
  }
}

export function legacyFileItemForResource(resource: ResourceSummary): FileItem | null {
  const path = legacyExplorerPath(resource.key)
  if (path === null) return null
  const type = mediaType(resource)
  const name = resource.name
  const extension = name.includes('.') ? (name.split('.').at(-1) ?? '') : ''
  return {
    name,
    path,
    type,
    size: resource.size ?? 0,
    extension,
    isDirectory: type === MediaType.FOLDER,
    ...(resource.key.provider === FILESYSTEM_PROVIDER ? {} : { isVirtual: true }),
  }
}
