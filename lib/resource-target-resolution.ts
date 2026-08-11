import { api } from './api'
import {
  isResourceSummary,
  type PersistedResourceTarget,
  type ResourceDetail,
  type ResourceSummary,
} from './resource'
import type { WorkspaceWindowDefinition } from './use-workspace'
import type { WorkspaceTaskbarPin } from './workspace-taskbar-pins'

export type ResourceInspectAccess =
  | { kind: 'owner'; surface?: 'library' | 'workspace' | 'canvas' }
  | { kind: 'grant'; token: string }

export function resourceTargetKey(target: PersistedResourceTarget): string {
  return `${target.ref.libraryId}\u0000${target.ref.resourceId}`
}

export function resourceTargetAttemptKey(
  target: PersistedResourceTarget,
  sessionKey: string,
): string {
  return `${sessionKey}\u0000${resourceTargetKey(target)}`
}

export function legacyResourceAttemptKey(legacyLocator: string, sessionKey: string): string {
  return `${sessionKey}\u0000legacy\u0000${legacyLocator.replace(/\\/g, '/')}`
}

export function legacyResourceIsPending(
  legacyLocator: string | null,
  attemptedKeys: ReadonlySet<string>,
  sessionKey: string,
): boolean {
  return (
    legacyLocator !== null &&
    !attemptedKeys.has(legacyResourceAttemptKey(legacyLocator, sessionKey))
  )
}

export function resourceTargetIsPending(
  target: PersistedResourceTarget | null | undefined,
  attemptedKeys: ReadonlySet<string>,
  sessionKey: string,
): boolean {
  return !!(
    target &&
    !target.availability &&
    !attemptedKeys.has(resourceTargetAttemptKey(target, sessionKey))
  )
}

export function resourceInspectUrl(
  target: PersistedResourceTarget,
  access: ResourceInspectAccess,
): string {
  const params = new URLSearchParams({
    libraryId: target.ref.libraryId,
    resourceId: target.ref.resourceId,
  })
  if (access.kind === 'owner') {
    params.set('surface', access.surface ?? 'workspace')
    return `/api/resources/inspect?${params}`
  }
  return `/api/share/${encodeURIComponent(access.token)}/resources/inspect?${params}`
}

export function legacyResourceResolveUrl(
  legacyLocator: string,
  access: ResourceInspectAccess,
): string {
  const params = new URLSearchParams({ legacyLocator })
  if (access.kind === 'owner') {
    params.set('surface', access.surface ?? 'workspace')
    return `/api/resources/resolve?${params}`
  }
  return `/api/share/${encodeURIComponent(access.token)}/resources/resolve?${params}`
}

export async function inspectResourceTarget(
  target: PersistedResourceTarget,
  access: ResourceInspectAccess,
  signal?: AbortSignal,
): Promise<ResourceSummary | null> {
  const detail = await api<ResourceDetail>(resourceInspectUrl(target, access), { signal })
  return detail?.schemaVersion === 1 && isResourceSummary(detail.summary) ? detail.summary : null
}

export async function resolveLegacyResourceTarget(
  legacyLocator: string,
  access: ResourceInspectAccess,
  signal?: AbortSignal,
): Promise<ResourceSummary | null> {
  const detail = await api<ResourceDetail>(legacyResourceResolveUrl(legacyLocator, access), {
    signal,
  })
  return detail?.schemaVersion === 1 && isResourceSummary(detail.summary) ? detail.summary : null
}

const HERMES_SESSION_LEGACY_PREFIX = 'Hermes Sessions/session/'

function legacyHermesSessionLocator(window: WorkspaceWindowDefinition): string | null {
  const sessionId = window.hermes?.sessionId?.trim()
  if (!sessionId || sessionId.includes('/') || sessionId.includes('\\')) return null
  const expected = `${HERMES_SESSION_LEGACY_PREFIX}${sessionId}`
  const iconPath = window.iconPath?.replace(/\\/g, '/').replace(/\/+$/, '')
  return iconPath === expected ? iconPath : expected
}

export function legacyResourceLocatorForWindow(window: WorkspaceWindowDefinition): string | null {
  if (window.resourceTarget) return null
  if (window.type === 'hermes') return legacyHermesSessionLocator(window)
  const value = window.type === 'browser' ? window.initialState.dir : window.initialState.viewing
  return typeof value === 'string' ? value : null
}

export function legacyResourceLocatorForPin(pin: WorkspaceTaskbarPin): string | null {
  return !pin.resourceTarget ? pin.path : null
}

function sameReference(target: PersistedResourceTarget, summary: ResourceSummary): boolean {
  return (
    target.ref.libraryId === summary.ref.libraryId &&
    target.ref.resourceId === summary.ref.resourceId
  )
}

function unavailableTarget(
  target: PersistedResourceTarget | undefined,
  summary: ResourceSummary,
): PersistedResourceTarget | null {
  if (!target || !sameReference(target, summary) || summary.availability === 'present') return null
  return {
    ref: { ...target.ref },
    legacyLocator: target.legacyLocator,
    availability: summary.availability,
  }
}

function usableLocator(
  target: PersistedResourceTarget | undefined,
  summary: ResourceSummary,
): string | null {
  if (!target || !sameReference(target, summary) || summary.legacyLocator === undefined) return null
  return summary.availability === 'present' ? summary.legacyLocator : null
}

function parentLocator(locator: string): string {
  const normalized = locator.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash < 0 ? '' : normalized.slice(0, slash)
}

export function reconcileResourceTargetWindow(
  window: WorkspaceWindowDefinition,
  summary: ResourceSummary,
): WorkspaceWindowDefinition {
  const unavailable = unavailableTarget(window.resourceTarget, summary)
  if (unavailable) return { ...window, resourceTarget: unavailable }
  const locator = usableLocator(window.resourceTarget, summary)
  if (locator === null) return window
  const resourceTarget = { ref: { ...summary.ref }, legacyLocator: locator }
  if (window.type === 'browser') {
    return {
      ...window,
      title: summary.name,
      iconPath: locator,
      initialState: { ...window.initialState, dir: locator },
      resourceTarget,
    }
  }
  if (window.type === 'viewer') {
    return {
      ...window,
      title: summary.name,
      iconPath: locator,
      initialState: {
        ...window.initialState,
        dir: parentLocator(locator),
        viewing: locator,
      },
      resourceTarget,
    }
  }
  return { ...window, title: summary.name, iconPath: locator, resourceTarget }
}

export function reconcileResourceTargetPin(
  pin: WorkspaceTaskbarPin,
  summary: ResourceSummary,
): WorkspaceTaskbarPin {
  const unavailable = unavailableTarget(pin.resourceTarget, summary)
  if (unavailable) return { ...pin, resourceTarget: unavailable }
  const locator = usableLocator(pin.resourceTarget, summary)
  if (locator === null) return pin
  return {
    ...pin,
    path: locator,
    title: summary.name,
    isDirectory: summary.providerOperations.includes('browse'),
    resourceTarget: { ref: { ...summary.ref }, legacyLocator: locator },
  }
}

function backfilledTarget(
  legacyLocator: string,
  summary: ResourceSummary,
): PersistedResourceTarget | null {
  const locator = summary.availability === 'present' ? summary.legacyLocator : legacyLocator
  if (locator === undefined) return null
  return {
    ref: { ...summary.ref },
    legacyLocator: locator,
    ...(summary.availability === 'present' ? {} : { availability: summary.availability }),
  }
}

export function backfillLegacyResourceWindow(
  window: WorkspaceWindowDefinition,
  legacyLocator: string,
  summary: ResourceSummary,
): WorkspaceWindowDefinition {
  if (legacyResourceLocatorForWindow(window) !== legacyLocator) return window
  const resourceTarget = backfilledTarget(legacyLocator, summary)
  if (!resourceTarget) return window
  return reconcileResourceTargetWindow({ ...window, resourceTarget }, summary)
}

export function backfillLegacyResourcePin(
  pin: WorkspaceTaskbarPin,
  legacyLocator: string,
  summary: ResourceSummary,
): WorkspaceTaskbarPin {
  if (legacyResourceLocatorForPin(pin) !== legacyLocator) return pin
  const resourceTarget = backfilledTarget(legacyLocator, summary)
  if (!resourceTarget) return pin
  return reconcileResourceTargetPin({ ...pin, resourceTarget }, summary)
}
