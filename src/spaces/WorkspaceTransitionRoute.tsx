import { workspaceStorageBaseKey, workspaceStorageSessionKey } from '@/lib/use-workspace'
import { createBrowserSpaceTransport } from '@/lib/space-client'
import { Show, createSignal, lazy, onMount } from 'solid-js'
import { navigateSpace } from '../lib/routes'

const WorkspacePage = lazy(() =>
  import('../WorkspacePage').then((module) => ({ default: module.WorkspacePage })),
)

function workspaceImportSourceKey(sessionId: string): string {
  return workspaceStorageSessionKey(workspaceStorageBaseKey(null), sessionId)
}

export function WorkspaceTransitionRoute(props: { sessionId?: string }) {
  const [checked, setChecked] = createSignal(!props.sessionId)

  onMount(() => {
    if (!props.sessionId) return
    void createBrowserSpaceTransport()
      .listImports()
      .then((imports) => {
        const sourceKey = workspaceImportSourceKey(props.sessionId!)
        const imported = imports.find(
          (record) =>
            record.sourceKind === 'workspace' &&
            record.sourceKey === sourceKey &&
            record.spaceId &&
            record.status !== 'quarantined',
        )
        if (imported?.spaceId) {
          navigateSpace(imported.spaceId, { presentation: 'tiled', replace: true })
          return
        }
        setChecked(true)
      })
      .catch(() => setChecked(true))
  })

  return (
    <Show
      when={checked()}
      fallback={
        <main class='flex min-h-[70vh] items-center justify-center p-4'>
          <p class='text-muted-foreground text-sm'>Checking saved Space...</p>
        </main>
      }
    >
      <WorkspacePage />
    </Show>
  )
}
