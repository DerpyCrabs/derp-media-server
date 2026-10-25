import type { WindowDefinition } from '@/lib/models/window-model'
export type WorkspaceCommand = {
  id: string
  label: string
  detail?: string
  group: 'Windows' | 'Commands'
  disabled?: boolean
  active?: boolean
  focusWindowId?: string
  run: () => void
}
const requests = new Set<() => void>()
export function openWorkspaceCommands() {
  for (const open of requests) open()
}
export function onWorkspaceCommands(open: () => void) {
  requests.add(open)
  return () => {
    requests.delete(open)
  }
}
export function filterWorkspaceCommands(items: readonly WorkspaceCommand[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((item) =>
    words.every((word) =>
      `${item.label} ${item.detail ?? ''} ${item.group}`.toLocaleLowerCase().includes(word),
    ),
  )
}

export function windowCommands(
  windows: readonly WindowDefinition[],
  activeId: string | null | undefined,
  editable: boolean,
  focus: (id: string) => void,
): WorkspaceCommand[] {
  return [...windows]
    .sort((a, b) => (b.layout?.zIndex ?? 0) - (a.layout?.zIndex ?? 0))
    .map((window) => ({
      id: `window:${window.id}`,
      label: window.title || (window.type === 'browser' ? 'Files' : 'Untitled'),
      detail: [
        window.initialState.viewing ?? window.initialState.dir ?? window.hermes?.cwd ?? '',
        window.layout?.minimized ? 'Minimized' : '',
        window.tabPinned ? 'Pinned tab' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      group: 'Windows',
      active: window.id === activeId,
      disabled: !editable,
      focusWindowId: window.id,
      run: () => focus(window.id),
    }))
}
