import { isResourceError, type ResourceSummary } from '@/lib/domain/resource'
import type { ContentRegistry } from '@/src/features/content/registry'
import type { ResourceActionDescriptor } from '@/src/features/content/contracts'
import { explorerResourceKey } from './controller'
import type {
  ExplorerActionDescriptor,
  ExplorerDataSource,
  ExplorerItem,
  ExplorerLocation,
} from './types'

export type RegistryExplorerPayload = Readonly<{
  resource: ResourceSummary
}>

function actionEffect(id: string): 'rename' | 'delete' | undefined {
  const operation = id.split(/[.:/]/).at(-1)?.toLowerCase()
  if (operation === 'rename') return 'rename'
  if (
    operation === 'delete' ||
    operation === 'deletepermanently' ||
    operation === 'deleteproject'
  ) {
    return 'delete'
  }
  return undefined
}

function inferredActionInteraction(id: string): ExplorerActionDescriptor['interaction'] {
  const operation = id.split(/[.:/]/).at(-1)?.toLowerCase()
  if (operation === 'createfile' || operation === 'createfolder' || operation === 'rename') {
    return 'name'
  }
  if (operation === 'move' || operation === 'copy' || operation === 'movetoproject') {
    return 'destination'
  }
  if (operation === 'upload') return 'upload'
  if (operation === 'paste') return 'paste'
  if (
    operation === 'addprojectfolder' ||
    operation === 'removeprojectfolder' ||
    operation === 'setprimaryfolder'
  ) {
    return 'text'
  }
  if (operation === 'setappearance') return 'appearance'
  return 'immediate'
}

function explorerAction(
  action: ResourceActionDescriptor,
  scope: 'resource' | 'location',
): ExplorerActionDescriptor {
  const optimisticEffect = actionEffect(action.id)
  return {
    id: action.id,
    label: action.label,
    capability: action.capability,
    scope,
    interaction: action.interaction ?? inferredActionInteraction(action.id),
    ...(action.dangerous ? { destructive: true } : {}),
    ...(optimisticEffect ? { optimisticEffect } : {}),
  }
}

export function registryExplorerItem(
  registry: ContentRegistry,
  resource: ResourceSummary,
  scope: 'resource' | 'location',
): ExplorerItem<RegistryExplorerPayload> {
  const actions = registry.actions(resource)?.list(resource) ?? []
  return {
    key: explorerResourceKey(resource.key),
    resource,
    actions: actions.map((action) => explorerAction(action, scope)),
    payload: { resource },
  }
}

export function registryExplorerLocation(key: ExplorerLocation['key']): ExplorerLocation {
  return { key }
}

export function createRegistryExplorerDataSource(
  registry: ContentRegistry,
): ExplorerDataSource<RegistryExplorerPayload> {
  return {
    async browse(request) {
      const provider = registry.browse(request.location.key)
      if (!provider)
        throw new Error(`Browse provider unavailable: ${request.location.key.provider}`)
      const page = await provider.browse({
        location: request.location.key,
        ...(request.cursor ? { cursor: request.cursor } : {}),
        ...(request.pageSize ? { limit: request.pageSize } : {}),
        signal: request.signal,
      })
      const locationResource =
        page.locationSummary ??
        ({
          key: page.location,
          name: page.location.id,
          kind: 'collection',
          capabilities: ['browse'],
          presentation: 'browse',
        } satisfies ResourceSummary)
      const locationItem = registryExplorerItem(registry, locationResource, 'location')
      return {
        location: registryExplorerLocation(page.location),
        locationItem,
        breadcrumbs: (page.breadcrumbs ?? [locationResource]).map((resource) => ({
          name: resource.name,
          location: registryExplorerLocation(resource.key),
          capabilities: resource.capabilities,
          item: registryExplorerItem(registry, resource, 'resource'),
        })),
        items: page.items.map((resource) => registryExplorerItem(registry, resource, 'resource')),
        actions: locationItem.actions,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        total: page.total,
      }
    },
    async execute(command, signal) {
      const actions = registry.actions(command.item.resource)
      if (!actions)
        throw new Error(`Action provider unavailable: ${command.item.resource.key.provider}`)
      const outcome = await actions.run({
        actionId: command.action.id,
        resource: command.item.resource,
        ...(command.input === undefined ? {} : { input: command.input }),
        signal,
      })
      if (isResourceError(outcome)) throw outcome
      return {
        commandId: command.id,
        affectedResources: [command.item.resource.key],
        ...(outcome === undefined ? {} : { outcome }),
      }
    },
  }
}
