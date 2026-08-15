import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import { createEffect, onSettled, type Accessor } from 'solid-js'
import { persistWorkspaceState } from './workspace-page-persistence'

export function useWorkspacePageLocalPersistence(options: {
  storageSessionKeyFull: Accessor<{ key: string }>
  workspace: Accessor<PersistedWorkspaceState | null>
}) {
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  createEffect(
    () => {
      const { key } = options.storageSessionKeyFull()
      const state = options.workspace()
      return key && state ? { key, state } : null
    },
    (persisted) => {
      if (!persisted) return undefined
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        persistWorkspaceState(persisted.key, persisted.state)
      }, 300)
      // eslint-disable-next-line solid/reactivity
      return () => {
        if (persistTimer) {
          clearTimeout(persistTimer)
          persistTimer = null
        }
      }
    },
  )

  onSettled(() => {
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
    return () => {
      window.removeEventListener('beforeunload', flushPersist)
      document.removeEventListener('visibilitychange', onVis)
    }
  })
}
