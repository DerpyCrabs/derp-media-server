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

function explorerAction(
  action: ResourceActionDescriptor,
  scope: 'resource' | 'location',
): ExplorerActionDescriptor {
  return {
    id: action.id,
    operation: action.operation,
    label: action.label,
    capability: action.capability,
    scope,
    interaction: action.interaction,
    ...(action.form ? { form: action.form } : {}),
    ...(action.dangerous ? { destructive: true } : {}),
    ...(action.optimisticEffect ? { optimisticEffect: action.optimisticEffect } : {}),
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
      const moduleRoot = registry.module(page.location.provider)?.root
      const atModuleRoot =
        moduleRoot?.key.provider === page.location.provider &&
        moduleRoot.key.id === page.location.id
      const contributedRoots = atModuleRoot
        ? registry.roots().filter((root) => root.key.provider !== page.location.provider)
        : []
      const resources = [...contributedRoots, ...page.items].filter(
        (resource, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.key.provider === resource.key.provider &&
              candidate.key.id === resource.key.id,
          ) === index,
      )
      return {
        location: registryExplorerLocation(page.location),
        locationItem,
        breadcrumbs: (page.breadcrumbs ?? [locationResource]).map((resource) => ({
          name: resource.name,
          location: registryExplorerLocation(resource.key),
          capabilities: resource.capabilities,
          item: registryExplorerItem(registry, resource, 'resource'),
        })),
        items: resources.map((resource) => registryExplorerItem(registry, resource, 'resource')),
        ...(page.recentItems
          ? {
              recentItems: page.recentItems.map((resource) => ({
                item: registryExplorerItem(registry, resource, 'resource'),
                ...(typeof resource.metadata?.modifiedAt === 'string'
                  ? { modifiedAt: resource.metadata.modifiedAt }
                  : {}),
              })),
            }
          : {}),
        actions: locationItem.actions,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        total: page.total + contributedRoots.length,
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
