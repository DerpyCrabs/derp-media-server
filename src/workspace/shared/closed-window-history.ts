import { modelOwner } from 'effectweb'
import {
  captureClosedWindows,
  type ClosedWorkspaceWindows,
} from '@/workspace/model/workspace-reopen'
import type { PersistedWorkspaceState } from '@/workspace/model/workspace'
import type { WindowDefinition } from '@/lib/models/window-model'
export function createClosedWindowHistory() {
  const owner = modelOwner({ revision: 0 })
  const entries = new Map<string, ClosedWorkspaceWindows[]>()
  const changed = () => owner.patch({ revision: owner.read().revision + 1 })
  return {
    source: owner.source,
    peek: (workspaceId: string) => entries.get(workspaceId)?.at(-1),
    record: (
      workspaceId: string,
      before: PersistedWorkspaceState,
      removed: readonly WindowDefinition[],
    ) => {
      const item = captureClosedWindows(before, removed)
      if (!workspaceId || !item) return
      const previous = entries.get(workspaceId) ?? []
      entries.delete(workspaceId)
      entries.set(workspaceId, [...previous.slice(-19), item])
      while (entries.size > 30) entries.delete(entries.keys().next().value!)
      changed()
    },
    consume: (workspaceId: string, item: ClosedWorkspaceWindows) => {
      const stack = entries.get(workspaceId)
      if (stack?.at(-1) !== item) return
      stack.pop()
      if (!stack.length) entries.delete(workspaceId)
      changed()
    },
    dispose: () => {
      entries.clear()
      owner.dispose()
    },
  }
}
