import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import { createEffect, onSettled, type Accessor } from 'solid-js'
import { persistWorkspaceState } from './workspace-page-persistence'

export function useWorkspacePageLocalPersistence(options: {
  storageSessionKeyFull: Accessor<{ key: string; sid: string }>
  workspace: Accessor<PersistedWorkspaceState | null>
  editable: Accessor<boolean>
}) {
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let observedKey = ''

  createEffect(
    () => {
      const { key } = options.storageSessionKeyFull()
      const state = options.workspace()
      return options.editable() && key && state ? { key, state } : null
    },
    (persisted) => {
      if (!persisted) {
        observedKey = ''
        return undefined
      }
      const sid = options.storageSessionKeyFull().sid
      if (observedKey === persisted.key) {
        if (sid) localStorage.setItem(`workspace-local-dirty-${sid}`, '1')
      } else {
        observedKey = persisted.key
      }
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        persistWorkspaceState(persisted.key, persisted.state)
        const currentSid = options.storageSessionKeyFull().sid
        if (currentSid)
          localStorage.setItem(`workspace-local-updated-${currentSid}`, String(Date.now()))
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
      const sid = options.storageSessionKeyFull().sid
      const w = options.workspace()
      if (options.editable() && k && w) {
        persistWorkspaceState(k, w)
        if (sid) localStorage.setItem(`workspace-local-updated-${sid}`, String(Date.now()))
      }
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
