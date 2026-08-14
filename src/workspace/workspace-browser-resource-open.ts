import {
  adaptFileItemResource,
  type AdaptedFileItemResource,
} from '@/lib/domain/file-item-resource'
import { resourceKey, type ResourceKey } from '@/lib/domain/resource'
import type { FileItem } from '@/lib/types'
import type { VirtualEntry } from '@/lib/virtual-directory'
import {
  openResource,
  type OpenContext,
  type OpenIntent,
  type OpenPlan,
} from '@/src/features/open/open-resource'
import { BUILT_IN_RENDERER_ID } from '@/src/features/open/renderer-registry'

export type PlannedWorkspaceBrowserResourceOpen = AdaptedFileItemResource &
  Readonly<{ plan: OpenPlan }>

export type WorkspaceBrowserOpenAction = 'navigate' | 'play' | 'view' | 'unsupported'

export function planWorkspaceBrowserResourceOpen(
  file: FileItem,
  intent: OpenIntent,
  context: OpenContext,
): PlannedWorkspaceBrowserResourceOpen {
  if (file.isVirtual) throw new Error('Workspace resource opener accepts non-virtual FileItem only')
  const adapted = adaptFileItemResource(file)
  return {
    ...adapted,
    plan: openResource(adapted.resource, intent, context),
  }
}

export function workspaceBrowserOpenAction(plan: OpenPlan): WorkspaceBrowserOpenAction {
  if (plan.status === 'blocked') return 'unsupported'
  if (plan.kind === 'browse') return 'navigate'
  if (
    plan.renderer === BUILT_IN_RENDERER_ID.audio ||
    plan.renderer === BUILT_IN_RENDERER_ID.video
  ) {
    return 'play'
  }
  return plan.renderer === BUILT_IN_RENDERER_ID.unsupported ? 'unsupported' : 'view'
}

export function explicitVirtualResourceKey(
  entry: Pick<VirtualEntry, 'provider' | 'id'>,
): ResourceKey | null {
  return entry.provider && entry.id ? resourceKey(entry.provider, entry.id) : null
}
