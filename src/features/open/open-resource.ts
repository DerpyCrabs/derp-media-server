import {
  RESOURCE_CAPABILITY,
  RESOURCE_KIND,
  RESOURCE_PRESENTATION,
  type ResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import {
  builtInRendererRegistry,
  type RendererIntent,
  type RendererRegistry,
} from './renderer-registry'

export type OpenIntent = 'default' | 'browse' | RendererIntent
export type OpenSurface = 'library' | 'workspace' | 'canvas'
export type OpenDisposition = 'replace' | 'modal' | 'fullscreen' | 'pane' | 'window'

export type OpenContext = Readonly<{
  surface: OpenSurface
  disposition: OpenDisposition
}>

type OpenTarget = Readonly<{
  resource: ResourceKey
  intent: OpenIntent
}>

export type BrowseOpenPlan = OpenTarget &
  Readonly<{
    status: 'ready'
    kind: 'browse'
    disposition: OpenDisposition
  }>

export type RenderOpenPlan = OpenTarget &
  Readonly<{
    status: 'ready'
    kind: 'render'
    renderer: string
    disposition: OpenDisposition
  }>

export type OpenReadyPlan = BrowseOpenPlan | RenderOpenPlan

export type OpenBlockReason =
  | 'incompatible-intent'
  | 'capability-unavailable'
  | 'renderer-unavailable'

export type OpenBlockedPlan = OpenTarget &
  Readonly<{
    status: 'blocked'
    reason: OpenBlockReason
    requiredCapabilities?: readonly string[]
  }>

export type OpenPlan = OpenReadyPlan | OpenBlockedPlan

export type ResourceOpener = (
  resource: ResourceSummary,
  intent: OpenIntent,
  context: OpenContext,
) => OpenPlan

function target(resource: ResourceSummary, intent: OpenIntent): OpenTarget {
  return { resource: { ...resource.key }, intent }
}

function blocked(
  resource: ResourceSummary,
  intent: OpenIntent,
  reason: OpenBlockReason,
  requiredCapabilities?: readonly string[],
): OpenBlockedPlan {
  return {
    ...target(resource, intent),
    status: 'blocked',
    reason,
    ...(requiredCapabilities ? { requiredCapabilities: [...requiredCapabilities] } : {}),
  }
}

function isBrowsable(resource: ResourceSummary): boolean {
  return (
    resource.presentation === RESOURCE_PRESENTATION.browse ||
    resource.kind === RESOURCE_KIND.root ||
    resource.kind === RESOURCE_KIND.folder ||
    resource.kind === RESOURCE_KIND.collection
  )
}

function hasAnyCapability(resource: ResourceSummary, required: readonly string[]): boolean {
  return required.some((capability) => resource.capabilities.includes(capability))
}

function browsePlan(resource: ResourceSummary, intent: OpenIntent, context: OpenContext): OpenPlan {
  const required = [RESOURCE_CAPABILITY.browse]
  if (!hasAnyCapability(resource, required)) {
    return blocked(resource, intent, 'capability-unavailable', required)
  }
  return {
    ...target(resource, intent),
    status: 'ready',
    kind: 'browse',
    disposition: context.disposition,
  }
}

export function createResourceOpener(registry: RendererRegistry): ResourceOpener {
  return (resource, intent, context) => {
    const browsable = isBrowsable(resource)
    if (intent === 'browse') {
      return browsable
        ? browsePlan(resource, intent, context)
        : blocked(resource, intent, 'incompatible-intent')
    }
    if (browsable && (intent === 'default' || intent === 'view')) {
      return browsePlan(resource, intent, context)
    }

    const descriptor = registry.resolve(resource, intent)
    if (!descriptor) {
      return blocked(
        resource,
        intent,
        intent === 'read' || intent === 'play' ? 'incompatible-intent' : 'renderer-unavailable',
      )
    }
    const required = descriptor.requiresAnyCapability
    if (required?.length && !hasAnyCapability(resource, required)) {
      return blocked(resource, intent, 'capability-unavailable', required)
    }
    return {
      ...target(resource, intent),
      status: 'ready',
      kind: 'render',
      renderer: descriptor.id,
      disposition: context.disposition,
    }
  }
}

export const openResource = createResourceOpener(builtInRendererRegistry)
