import { showAppConfirm } from '@/lib/ui/app-dialog'
import type { WorkspaceSession } from './WorkspaceSession'
import type { Accessor } from 'solid-js'

type WorkspaceLifecycleSession = Pick<
  WorkspaceSession,
  'registry' | 'deleteWorkspace' | 'convertWorkspace'
>

export function createWorkspaceLifecycleCommands(options: {
  session: WorkspaceLifecycleSession
  activeId: Accessor<string>
  navigate: (id: string, mode: 'push' | 'replace') => void
}) {
  async function deleteWorkspace(id: string) {
    const registry = options.session.registry()
    const record = registry.records[id]
    if (!record) return
    const confirmed = await showAppConfirm({
      title: 'Delete workspace?',
      message: `Delete “${record.name || 'Unnamed workspace'}” and close ${record.snapshot.windows.length} windows? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    const currentRegistry = options.session.registry()
    const index = currentRegistry.order.indexOf(id)
    await options.session.deleteWorkspace(id)
    if (id !== options.activeId()) return
    const next =
      currentRegistry.order[index + 1] ?? currentRegistry.order[index - 1] ?? crypto.randomUUID()
    options.navigate(next, 'replace')
  }

  async function convertWorkspace(id: string) {
    const record = options.session.registry().records[id]
    if (!record) return
    const target = record.snapshot.workspaceType === 'canvas' ? 'desktop' : 'canvas'
    const label = target === 'canvas' ? 'canvas' : 'desktop'
    const confirmed = await showAppConfirm({
      title: `Convert to ${label}?`,
      message: `Keep this workspace’s windows and switch it to the ${label} layout?`,
      confirmLabel: 'Convert',
    })
    if (!confirmed) return
    await options.session.convertWorkspace(id, target, {
      width: window.innerWidth,
      height: Math.max(1, window.innerHeight - 32),
    })
  }

  return { deleteWorkspace, convertWorkspace }
}
