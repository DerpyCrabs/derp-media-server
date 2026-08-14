import { resourceKey, type ResourceKey, type ResourceSummary } from '@/lib/domain/resource'
import type { RouteQueryUpdates } from '@/src/lib/routes'
import type { ContentInstance } from '@/lib/domain/content'
import { apiEndpoints, type StatsResponse } from '@/lib/api-endpoints'
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
} from '@/src/features/explorer/types'
import { getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'
import { buildMediaUrl } from '@/lib/api-media-urls'
import { subscribeSseApplication } from '@/src/lib/sse-shared-worker-client'
import { filesystemPathForResourceKey, filesystemResourceIsDirectory } from './filesystem/module'
import { filesystemResourceKeyForPath } from './filesystem/resource'
import { applicationContentRegistry } from './registry'
import { subscribeIntegrationAvailability } from './availability'
import { serverIntegrationSearchContributor } from './http-client'
import { SEARCH_DEFAULT_LIMIT } from '@/src/features/search/contracts'

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
  applicationExplorerSseUnsubscribe = subscribeSseApplication((event) => {
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

function filesystemActionAllowed(
  operation: string,
  path: string,
  editableFolders: readonly string[],
): boolean {
  switch (operation) {
    case 'rename':
    case 'delete':
    case 'move':
      return isPathEditable(path, [...editableFolders])
    case 'copy':
      return editableFolders.length > 0
    case 'createFile':
    case 'createFolder':
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
  const path = filesystemPathForResourceKey(item.resource.key)
  if (path === null) return item
  const actions = item.actions.filter((action) =>
    filesystemActionAllowed(action.operation, path, editableFolders),
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
  const recentItems = page.recentItems?.map((recent) => ({
    ...recent,
    item: filterFilesystemItem(recent.item, editableFolders),
  }))
  return {
    ...page,
    items,
    breadcrumbs,
    ...(recentItems ? { recentItems } : {}),
    ...(locationItem ? { locationItem, actions: locationItem.actions } : {}),
  }
}

function settingActions(
  item: ExplorerItem<ApplicationExplorerPayload>,
  settings: SettingsDto | null,
): ExplorerItem<ApplicationExplorerPayload> {
  const path = filesystemPathForResourceKey(item.resource.key)
  if (path === null || !settings) return item
  const metadata = item.resource.metadata ?? {}
  const isDirectory = filesystemResourceIsDirectory(item.resource)
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
      operation: 'favorite',
      label: favorite ? 'Unfavorite' : 'Favorite',
      capability: 'settings.favorite',
      scope: 'resource' as const,
      interaction: 'immediate' as const,
    },
    ...(isDirectory
      ? [
          {
            id: 'application.knowledgeBase',
            operation: 'knowledgeBase',
            label: knowledgeBase ? 'Remove Knowledge Base' : 'Set as Knowledge Base',
            capability: 'settings.knowledgeBase',
            scope: 'resource' as const,
            interaction: 'immediate' as const,
          },
          {
            id: 'application.customIcon',
            operation: 'customIcon',
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
  const recentItems = page.recentItems?.map((recent) => ({
    ...recent,
    item: settingActions(recent.item, settings),
  }))
  return {
    ...page,
    items,
    breadcrumbs,
    ...(recentItems ? { recentItems } : {}),
    ...(locationItem ? { locationItem, actions: locationItem.actions } : {}),
  }
}

function viewCountPage(
  page: ExplorerPage<ApplicationExplorerPayload>,
  stats: StatsResponse | null,
): ExplorerPage<ApplicationExplorerPayload> {
  if (!stats) return page
  const adaptItem = (item: ExplorerItem<ApplicationExplorerPayload>) => {
    const path = filesystemPathForResourceKey(item.resource.key)
    const viewCount = path === null ? undefined : stats.views[path]
    if (viewCount === undefined) return item
    const resource = {
      ...item.resource,
      metadata: { ...item.resource.metadata, viewCount },
    }
    return { ...item, resource, payload: { resource } }
  }
  return {
    ...page,
    items: page.items.map(adaptItem),
    ...(page.recentItems
      ? {
          recentItems: page.recentItems.map((recent) => ({
            ...recent,
            item: adaptItem(recent.item),
          })),
        }
      : {}),
  }
}

export function createApplicationExplorerDataSource(
  options: {
    editableFolders?: Accessor<readonly string[]>
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

  return {
    async browse(request) {
      const [page, currentSettings, currentConfig, currentStats] = await Promise.all([
        registrySource.browse(request),
        loadSettings(),
        options.editableFolders ? Promise.resolve(null) : loadServerConfig(),
        loadApplicationExplorerStats(),
      ])
      const editableFolders = options.editableFolders?.() ?? currentConfig?.editableFolders ?? []
      const filtered = settingPage(
        filterFilesystemPage(viewCountPage(page, currentStats), editableFolders),
        currentSettings,
      )
      const path = filesystemPathForResourceKey(filtered.location.key)
      const preferredViewMode =
        path !== null && currentSettings ? currentSettings.viewModes[path] : undefined
      const withViewMode = preferredViewMode ? { ...filtered, preferredViewMode } : filtered
      const knowledgeBaseRoot =
        path === null || !currentSettings
          ? null
          : getKnowledgeBaseRoot(path, currentSettings.knowledgeBases)
      return knowledgeBaseRoot
        ? {
            ...withViewMode,
            defaultFileExtension: 'md',
            contentSearch: {
              label: 'Search note contents',
              placeholder: 'Search notes...',
            },
          }
        : withViewMode
    },
    async search(request) {
      const path = filesystemPathForResourceKey(request.location.key)
      if (path === null || !request.query.trim()) return []
      const currentSettings = await loadSettings()
      const knowledgeBaseRoot = currentSettings
        ? getKnowledgeBaseRoot(path, currentSettings.knowledgeBases)
        : null
      if (!knowledgeBaseRoot) return []
      const response = await serverIntegrationSearchContributor.search({
        query: request.query,
        limit: SEARCH_DEFAULT_LIMIT,
        signal: request.signal,
      })
      return response.results.flatMap((result) => {
        const resource = result.resource
        const resultPath = resource ? filesystemPathForResourceKey(resource.key) : null
        if (
          !resource ||
          result.group !== 'filesystem.knowledge' ||
          resultPath === null ||
          getKnowledgeBaseRoot(resultPath, [knowledgeBaseRoot]) !== knowledgeBaseRoot
        ) {
          return []
        }
        return [
          {
            item: settingActions(
              registryExplorerItem(applicationContentRegistry, resource, 'resource'),
              currentSettings,
            ),
            ...(result.snippet ? { snippet: result.snippet } : {}),
            ...(result.detail ? { subtitle: result.detail } : {}),
          },
        ]
      })
    },
    async preview(item, signal) {
      const path = filesystemPathForResourceKey(item.resource.key)
      if (path === null) return {}
      const response = await fetch(buildMediaUrl(path), { signal })
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
      const path = filesystemPathForResourceKey(command.item.resource.key)
      if (path !== null && command.action.operation === 'favorite') {
        await apiEndpoints.settings.toggleFavorite({ filePath: path })
        settings = await apiEndpoints.settings.get()
        loadedSettingsGeneration = applicationExplorerSettingsGeneration
        notifyApplicationExplorers()
        return { commandId: command.id, affectedResources: [command.item.resource.key] }
      }
      if (path !== null && command.action.operation === 'knowledgeBase') {
        await apiEndpoints.settings.toggleKnowledgeBase({ filePath: path })
        settings = await apiEndpoints.settings.get()
        loadedSettingsGeneration = applicationExplorerSettingsGeneration
        notifyApplicationExplorers()
        return { commandId: command.id, affectedResources: [command.item.resource.key] }
      }
      if (path !== null && command.action.operation === 'customIcon') {
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
      const receipt = await registrySource.execute(command, signal)
      notifyApplicationExplorers()
      return receipt
    },
    async persistState(location, state) {
      const path = filesystemPathForResourceKey(location.key)
      if (path === null || !state.viewMode || settings?.viewModes[path] === state.viewMode) return
      await apiEndpoints.settings.setViewMode({ path, viewMode: state.viewMode })
      if (settings)
        settings = { ...settings, viewModes: { ...settings.viewModes, [path]: state.viewMode } }
    },
    subscribe(listener) {
      applicationExplorerListeners.add(listener)
      ensureApplicationExplorerEvents()
      const unsubscribeAvailability = subscribeIntegrationAvailability(listener)
      return () => {
        unsubscribeAvailability()
        applicationExplorerListeners.delete(listener)
        releaseApplicationExplorerEventsIfIdle()
      }
    },
  }
}

export function explorerLocationFromQuery(params: URLSearchParams): ExplorerLocation {
  const provider = params.get('provider')
  const id = params.get('resource')
  if (provider && id) {
    try {
      return { key: resourceKey(provider, id) }
    } catch {}
  }
  return { key: filesystemResourceKeyForPath('') }
}

export function explorerLocationQuery(key: ResourceKey): RouteQueryUpdates {
  return { provider: key.provider, resource: key.id }
}

export async function recordApplicationExplorerView(resource: ResourceSummary): Promise<void> {
  const path = filesystemPathForResourceKey(resource.key)
  if (path === null || resource.capabilities.includes('browse')) return
  const result = await apiEndpoints.stats.addView(path)
  applicationExplorerStats = {
    views: { ...(applicationExplorerStats?.views ?? {}), [path]: result.viewCount },
  }
  notifyApplicationExplorers()
}

export async function moveFilesystemItemByPath(
  sourcePath: string,
  destination: ResourceSummary,
): Promise<boolean> {
  const destinationPath = filesystemPathForResourceKey(destination.key)
  if (destinationPath === null) return false
  const name = sourcePath.split(/[/\\]/).at(-1) ?? ''
  const resource: ResourceSummary = {
    key: filesystemResourceKeyForPath(sourcePath),
    name,
    kind: 'file',
    capabilities: ['filesystem.move'],
  }
  const provider = applicationContentRegistry.actions(resource)
  const action = provider?.list(resource).find((candidate) => candidate.operation === 'move')
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

export async function openApplicationResource(
  key: ResourceKey,
  name: string,
  options?: Readonly<{ browse?: boolean }>,
): Promise<ContentInstance | null> {
  if (options?.browse) {
    return { id: `pinned-${key.provider}-explorer`, type: 'explorer', location: key }
  }
  const resource: ResourceSummary = {
    key,
    name,
    kind: 'resource',
    capabilities: ['read', `${key.provider}.open`],
  }
  const provider = applicationContentRegistry.actions(resource)
  const action = provider?.list(resource).find((candidate) => candidate.operation === 'open')
  if (!provider || !action) return null
  const outcome = await provider.run({ actionId: action.id, resource })
  if (outcome && 'schemaVersion' in outcome && 'code' in outcome) throw outcome
  return outcome?.content ?? null
}
