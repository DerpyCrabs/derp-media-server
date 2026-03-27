import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { createEffect, onCleanup, onMount, type Accessor } from 'solid-js'
import { persistWorkspaceState } from '../workspace-page-persistence'

export function useWorkspacePageLocalPersistence(options: {
  storageSessionKeyFull: Accessor<{ key: string }>
  workspace: Accessor<PersistedWorkspaceState | null>
  isShareSession: Accessor<boolean>
}) {
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  createEffect(() => {
    const { key } = options.storageSessionKeyFull()
    const w = options.workspace()
    if (!key || !w) return
    if (options.isShareSession()) {
      persistWorkspaceState(key, w)
      return
    }
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistWorkspaceState(key, w)
    }, 300)
    onCleanup(() => {
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
    })
  })

  onMount(() => {
    const flushPersist = () => {
      const k = options.storageSessionKeyFull().key
      const w = options.workspace()
      if (k && w) persistWorkspaceState(k, w)
    }
    window.addEventListener('beforeunload', flushPersist)
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushPersist()
    }
    document.addEventListener('visibilitychange', onVis)
    onCleanup(() => {
      window.removeEventListener('beforeunload', flushPersist)
      document.removeEventListener('visibilitychange', onVis)
    })
  })
}
