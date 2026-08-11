import type { ResourceSummary } from '@/lib/resource'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { openResource, type OpenContext } from './open-resource'
import { viewerMediaType, viewerReaderKind } from './viewer-registry'

export function reconcileResolvedWindowPresentation(
  window: WorkspaceWindowDefinition,
  summary: ResourceSummary,
  context: OpenContext,
): WorkspaceWindowDefinition {
  if (window.type !== 'viewer') return window
  const plan = openResource(summary, 'default', context)
  if (plan.kind !== 'viewer' && plan.kind !== 'playback') return window
  const { readerKind: _staleReaderKind, ...initialState } = window.initialState
  const readerKind = viewerReaderKind(plan.viewer.id)
  return {
    ...window,
    viewerId: plan.viewer.id,
    iconType: viewerMediaType(plan.viewer.id) ?? window.iconType,
    initialState: {
      ...initialState,
      ...(readerKind ? { readerKind } : {}),
    },
  }
}
