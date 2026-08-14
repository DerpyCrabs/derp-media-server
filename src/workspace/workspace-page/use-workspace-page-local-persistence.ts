import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { createEffect, onCleanup, onMount, type Accessor } from 'solid-js'
import { persistWorkspaceState } from '../workspace-page-persistence'

export function useWorkspacePageLocalPersistence(options: {
  storageSessionKeyFull: Accessor<{ key: string }>
  workspace: Accessor<PersistedWorkspaceState | null>
}) {
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let lastStorageKey = ''

  const flush = () => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    const key = options.storageSessionKeyFull().key || lastStorageKey
    const workspace = options.workspace()
    if (key && workspace) persistWorkspaceState(key, workspace)
  }

  createEffect(() => {
    const { key } = options.storageSessionKeyFull()
    const w = options.workspace()
    if (!key || !w) return
    lastStorageKey = key
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
    window.addEventListener('beforeunload', flush)
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVis)
    onCleanup(() => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    })
  })

  onCleanup(flush)
  return Object.freeze({ flush })
}
