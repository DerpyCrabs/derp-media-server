import { Effect } from 'effect'
import { commandSlot, type lifetime } from 'effectweb'
const deleteSlot = commandSlot('delete-workspace')
const convertSlot = commandSlot('convert-workspace')
import { randomId } from '@/lib/random-id'
import { showAppConfirmEffect } from '@/lib/ui/app-dialog'
import type { WorkspaceSession } from './WorkspaceSession'
type Accessor<T> = () => T
type WorkspaceLifecycleSession = Pick<WorkspaceSession, 'catalog' | 'lifecycle'>
export function createWorkspaceLifecycleCommands(options: {
  owner: Pick<ReturnType<typeof lifetime>, 'run'>
  session: WorkspaceLifecycleSession
  activeId: Accessor<string>
  navigate: (id: string, mode: 'push' | 'replace') => void
}) {
  const deleteWorkspace = (id: string) =>
    options.owner.run(
      deleteSlot,
      Effect.gen(function* () {
        const registry = options.session.catalog.value()
        const record = registry.records[id]
        if (!record) return
        const confirmed = yield* showAppConfirmEffect({
          title: 'Delete workspace?',
          message: `Delete “${record.name || 'Unnamed workspace'}” and close ${record.snapshot.windows.length} windows? This cannot be undone.`,
          confirmLabel: 'Delete',
          destructive: true,
        })
        if (!confirmed) return
        const currentRegistry = options.session.catalog.value()
        const index = currentRegistry.order.indexOf(id)
        yield* options.session.catalog.delete(id)
        if (id !== options.activeId()) return
        const next =
          currentRegistry.order[index + 1] ?? currentRegistry.order[index - 1] ?? randomId()
        options.navigate(next, 'replace')
      }),
      'drop',
    )
  const convertWorkspace = (id: string) =>
    options.owner.run(
      convertSlot,
      Effect.gen(function* () {
        const record = options.session.catalog.value().records[id]
        if (!record) return
        const target = record.snapshot.workspaceType === 'canvas' ? 'desktop' : 'canvas'
        const label = target === 'canvas' ? 'canvas' : 'desktop'
        const confirmed = yield* showAppConfirmEffect({
          title: `Convert to ${label}?`,
          message: `Keep this workspace’s windows and switch it to the ${label} layout?`,
          confirmLabel: 'Convert',
        })
        if (!confirmed) return
        yield* options.session.lifecycle.convert(id, target, {
          width: window.innerWidth,
          height: Math.max(1, window.innerHeight - 32),
        })
      }),
      'drop',
    )
  return { deleteWorkspace, convertWorkspace }
}
