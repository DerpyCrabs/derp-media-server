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

export async function inspectResourceTarget(
  target: PersistedResourceTarget,
  access: ResourceInspectAccess,
  signal?: AbortSignal,
): Promise<ResourceSummary | null> {
  const detail = await api<ResourceDetail>(resourceInspectUrl(target, access), { signal })
  return detail?.schemaVersion === 1 && isResourceSummary(detail.summary) ? detail.summary : null
}

function sameReference(target: PersistedResourceTarget, summary: ResourceSummary): boolean {
  return (
    target.ref.libraryId === summary.ref.libraryId &&
    target.ref.resourceId === summary.ref.resourceId
  )
}

function usableLocator(
  target: PersistedResourceTarget | undefined,
  summary: ResourceSummary,
): string | null {
  if (
    !target ||
    !sameReference(target, summary) ||
    summary.availability !== 'present' ||
    !summary.legacyLocator
  ) {
    return null
  }
  return summary.legacyLocator
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
  const locator = usableLocator(window.resourceTarget, summary)
  if (!locator) return window
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
  const locator = usableLocator(pin.resourceTarget, summary)
  if (!locator) return pin
  return {
    ...pin,
    path: locator,
    title: summary.name,
    isDirectory: summary.providerOperations.includes('browse'),
    resourceTarget: { ref: { ...summary.ref }, legacyLocator: locator },
  }
}
