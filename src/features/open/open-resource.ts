import {
  RESOURCE_CAPABILITY,
  resourceIsBrowsable,
  type ResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import type { ContentInstance } from '@/lib/domain/content'
import { type RendererIntent, type RendererRegistry } from './renderer-registry'

export type OpenIntent = 'default' | 'browse' | RendererIntent
export type OpenSurface = 'library' | 'workspace' | 'canvas'
export type OpenDisposition = 'replace' | 'modal' | 'fullscreen' | 'pane' | 'window'

export type OpenContext = Readonly<{
  surface: OpenSurface
  disposition: OpenDisposition
}>

type OpenTarget = Readonly<{
  summary: ResourceSummary
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

export function contentForOpenPlan(
  plan: OpenReadyPlan,
  id: string,
  context?: ResourceKey,
): ContentInstance {
  if (plan.kind === 'browse') return { id, type: 'explorer', location: plan.summary.key }
  return {
    id,
    type: 'resource',
    resource: plan.summary.key,
    renderer: plan.renderer,
    ...(context ? { context } : {}),
  }
}

export type ResourceOpener = (
  resource: ResourceSummary,
  intent: OpenIntent,
  context: OpenContext,
) => OpenPlan

function target(resource: ResourceSummary, intent: OpenIntent): OpenTarget {
  return { summary: resource, intent }
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
    const browsable = resourceIsBrowsable(resource)
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
