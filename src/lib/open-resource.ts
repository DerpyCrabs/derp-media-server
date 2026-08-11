import type {
  ProviderOperation,
  ResourceOpenTarget,
  ResourceRef,
  ResourceSummary,
  ResourceVersion,
} from '@/lib/resource'
import {
  builtInViewerRegistry,
  type ViewerDescriptor,
  type ViewerId,
  type ViewerRegistry,
} from './viewer-registry'

export type OpenIntent = 'default' | 'browse' | 'view' | 'read' | 'play'
export type OpenSurface = 'library' | 'workspace' | 'canvas' | 'share'

export type OpenScope = Readonly<{ kind: 'owner'; id?: string } | { kind: 'grant'; id: string }>

export type OpenPresentationConstraints = Readonly<{
  allowPlayback?: boolean
  allowConversation?: boolean
  allowedViewerIds?: readonly ViewerId[]
}>

export type OpenContext = Readonly<{
  surface: OpenSurface
  scope: OpenScope
  effectiveOperations?: readonly ProviderOperation[]
  presentationConstraints?: OpenPresentationConstraints
}>

type OpenTarget = Readonly<{
  resource: ResourceRef
  version?: ResourceVersion
}>

export type OpenBlockReason =
  | 'resource-missing'
  | 'source-unavailable'
  | 'incompatible-intent'
  | 'operation-unavailable'
  | 'missing-open-target'
  | 'unsupported-presentation'
  | 'presentation-constrained'

export type OpenPlan =
  | (OpenTarget & { kind: 'browse' })
  | (OpenTarget & {
      kind: 'playback'
      media: 'audio' | 'video'
      viewer: ViewerDescriptor
    })
  | (OpenTarget & { kind: 'viewer'; viewer: ViewerDescriptor })
  | (OpenTarget & {
      kind: 'conversation'
      target: ResourceOpenTarget
      viewer: ViewerDescriptor
    })
  | (OpenTarget & {
      kind: 'blocked'
      reason: OpenBlockReason
      requiredOperations?: readonly ProviderOperation[]
    })

export type ResourceOpener = (
  resource: ResourceSummary,
  intent: OpenIntent,
  context: OpenContext,
) => OpenPlan

function target(resource: ResourceSummary): OpenTarget {
  return {
    resource: { ...resource.ref },
    ...(resource.version === undefined ? {} : { version: resource.version }),
  }
}

function blocked(
  resource: ResourceSummary,
  reason: OpenBlockReason,
  requiredOperations?: readonly ProviderOperation[],
): OpenPlan {
  return {
    ...target(resource),
    kind: 'blocked',
    reason,
    ...(requiredOperations ? { requiredOperations } : {}),
  }
}

function hasOperation(
  resource: ResourceSummary,
  operations: readonly ProviderOperation[],
  context: OpenContext,
): boolean {
  return operations.some(
    (operation) =>
      resource.providerOperations.includes(operation) &&
      (context.effectiveOperations === undefined ||
        context.effectiveOperations.includes(operation)),
  )
}

function isBrowsable(resource: ResourceSummary): boolean {
  return (
    resource.presentation === 'browse' ||
    resource.kind === 'library' ||
    resource.kind === 'source' ||
    resource.kind === 'folder' ||
    resource.kind === 'collection' ||
    resource.kind === 'conversationProject'
  )
}

function isConversation(resource: ResourceSummary): boolean {
  return (
    resource.kind === 'conversation' ||
    resource.kind === 'draft' ||
    resource.presentation === 'conversation'
  )
}

function planBrowse(resource: ResourceSummary, context: OpenContext): OpenPlan {
  const required = ['browse'] as const
  if (!hasOperation(resource, required, context)) {
    return blocked(resource, 'operation-unavailable', required)
  }
  return { ...target(resource), kind: 'browse' }
}

function presentationAllowed(viewer: ViewerDescriptor, context: OpenContext): boolean {
  const constraints = context.presentationConstraints
  if (!constraints) return true
  if (viewer.role === 'playback' && constraints.allowPlayback === false) return false
  if (viewer.role === 'conversation' && constraints.allowConversation === false) return false
  return constraints.allowedViewerIds?.includes(viewer.id) ?? true
}

function planViewer(
  resource: ResourceSummary,
  viewer: ViewerDescriptor,
  context: OpenContext,
): OpenPlan {
  if (!presentationAllowed(viewer, context)) {
    return blocked(resource, 'presentation-constrained')
  }
  const required = viewer.id === 'folder-reader' ? (['browse'] as const) : (['read'] as const)
  if (!hasOperation(resource, required, context)) {
    return blocked(resource, 'operation-unavailable', required)
  }
  return { ...target(resource), kind: 'viewer', viewer }
}

function planDefault(
  resource: ResourceSummary,
  registry: ViewerRegistry,
  context: OpenContext,
): OpenPlan {
  if (!isConversation(resource) && isBrowsable(resource)) return planBrowse(resource, context)

  const viewer = registry.lookup(resource)
  if (!viewer) return blocked(resource, 'unsupported-presentation')
  if (!presentationAllowed(viewer, context)) {
    return blocked(resource, 'presentation-constrained')
  }
  if (viewer.role === 'playback') {
    const required = ['stream', 'read'] as const
    if (!hasOperation(resource, required, context)) {
      return blocked(resource, 'operation-unavailable', required)
    }
    return {
      ...target(resource),
      kind: 'playback',
      media: viewer.media,
      viewer,
    }
  }
  if (viewer.role === 'conversation') {
    if (!hasOperation(resource, ['read'], context)) {
      return blocked(resource, 'operation-unavailable', ['read'])
    }
    if (!resource.openTarget) return blocked(resource, 'missing-open-target')
    return {
      ...target(resource),
      kind: 'conversation',
      target: resource.openTarget,
      viewer,
    }
  }
  return planViewer(resource, viewer, context)
}

export function createResourceOpener(registry: ViewerRegistry): ResourceOpener {
  return (resource, intent, context) => {
    if (resource.availability === 'missing') return blocked(resource, 'resource-missing')
    if (resource.availability === 'sourceUnavailable') {
      return blocked(resource, 'source-unavailable')
    }

    if (intent === 'default' || intent === 'view') return planDefault(resource, registry, context)
    if (intent === 'browse') {
      return isBrowsable(resource)
        ? planBrowse(resource, context)
        : blocked(resource, 'incompatible-intent')
    }
    if (intent === 'play') {
      const viewer = registry.lookup(resource)
      return viewer?.role === 'playback'
        ? planDefault(resource, registry, context)
        : blocked(resource, 'incompatible-intent')
    }

    const reader = registry.lookup(resource, 'read')
    return reader ? planViewer(resource, reader, context) : blocked(resource, 'incompatible-intent')
  }
}

export const openResource = createResourceOpener(builtInViewerRegistry)
