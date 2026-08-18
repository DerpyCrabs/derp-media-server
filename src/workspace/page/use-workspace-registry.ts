import { api, isApiError, post } from '@/lib/api/client'
import {
  normalizePersistedWorkspaceState,
  sanitizePersistedWorkspaceState,
  toPersistentWorkspaceState,
  type PersistedWorkspaceState,
} from '@/workspace/model/use-workspace'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import type { PinnedTaskbarItem } from '@/workspace/model/use-workspace'
import {
  mergeWorkspaceConflict,
  shareWorkspaceReferences,
} from '@/workspace/model/workspace-conflict-merge'
import {
  type WorkspaceOpenResult,
  type WorkspaceRecord,
  type WorkspaceRegistry,
  workspaceClientId,
} from '@/workspace/model/workspace-registry'
import {
  createEffect,
  createSignal,
  onSettled,
  snapshot,
  untrack,
  type Accessor,
  type Setter,
} from 'solid-js'

const EMPTY: WorkspaceRegistry = { version: 1, order: [], records: {} }

export function useWorkspaceRegistry(options: {
  workspaceId: Accessor<string>
  workspace: Accessor<PersistedWorkspaceState | null>
  setWorkspace: Setter<PersistedWorkspaceState | null>
  savingBlocked?: Accessor<boolean>
}) {
  const clientId = workspaceClientId()
  const [registry, setRegistry] = createSignal<WorkspaceRegistry>(EMPTY)
  const [ready, setReady] = createSignal(false)
  const [editable, setEditable] = createSignal(true)
  const [openedId, setOpenedId] = createSignal('')
  const [revision, setRevision] = createSignal(0)
  const [offline, setOffline] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  let openingId = ''
  let openSequence = 0
  let refreshSequence = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let metadataWrite: Promise<void> = Promise.resolve()
  type PendingSave = {
    id: string
    state: PersistedWorkspaceState
    currentRevision: number
  }
  let queuedSave: PendingSave | null = null
  let saveDrain: Promise<void> | null = null

  function currentQueuedSave() {
    return queuedSave
  }

  function sanitizeRecord(record: WorkspaceRecord): WorkspaceRecord {
    return {
      ...record,
      snapshot: sanitizePersistedWorkspaceState(record.snapshot),
    }
  }

  function sanitizeRegistry(value: WorkspaceRegistry): WorkspaceRegistry {
    return {
      ...value,
      records: Object.fromEntries(
        Object.entries(value.records).map(([id, record]) => [id, sanitizeRecord(record)]),
      ),
    }
  }

  function readSyncedState(id: string) {
    try {
      return normalizePersistedWorkspaceState(
        JSON.parse(localStorage.getItem(`workspace-synced-${id}`) ?? 'null'),
        { reconcileSnapZones: false },
      )
    } catch {
      return null
    }
  }

  function setWorkspaceIfChanged(next: PersistedWorkspaceState) {
    const current = options.workspace()
    if (
      current &&
      JSON.stringify(toPersistentWorkspaceState(current)) ===
        JSON.stringify(toPersistentWorkspaceState(next))
    )
      return
    options.setWorkspace(current ? shareWorkspaceReferences(current, next) : structuredClone(next))
  }

  async function migrateLocalWorkspaces() {
    const marker = 'workspace-server-migration-v1'
    if (localStorage.getItem(marker)) return
    const workspaces: { id: string; snapshot: PersistedWorkspaceState }[] = []
    const pins = new Map<string, PinnedTaskbarItem>()
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith('workspace-state-ws-')) continue
      try {
        const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown
        const state = normalizePersistedWorkspaceState(raw, {
          reconcileSnapZones: false,
        })
        if (!state) continue
        workspaces.push({
          id: key.slice('workspace-state-ws-'.length),
          snapshot: state,
        })
        for (const pin of state.pinnedTaskbarItems ?? []) {
          pins.set(`${pin.source.kind}:${pin.path}`, pin)
        }
      } catch {
        // Ignore broken legacy drafts; normal hydration already does the same.
      }
    }
    if (workspaces.length > 0) {
      await post('/api/workspaces/import', { workspaces })
    }
    if (pins.size > 0) {
      const settings = await api<WorkspaceSettings>('/api/settings')
      for (const pin of settings.workspaceTaskbarPins ?? []) {
        pins.set(`${pin.source.kind}:${pin.path}`, pin)
      }
      await post('/api/settings/workspaceTaskbarPins', {
        items: [...pins.values()],
      })
    }
    localStorage.setItem(marker, '1')
  }

  async function persistOne(pending: PendingSave) {
    const state = toPersistentWorkspaceState(pending.state)
    let completedRevision: number | undefined
    try {
      const result = await post<{ revision: number }>('/api/workspaces/save', {
        id: pending.id,
        clientId,
        revision: pending.currentRevision,
        snapshot: state,
      })
      completedRevision = result.revision
      if (options.workspaceId() === pending.id) setRevision(result.revision)
      localStorage.setItem(`workspace-revision-${pending.id}`, String(result.revision))
      localStorage.setItem(`workspace-synced-${pending.id}`, JSON.stringify(state))
      localStorage.removeItem(`workspace-offline-${pending.id}`)
      if (
        options.workspace() &&
        JSON.stringify(toPersistentWorkspaceState(options.workspace()!)) === JSON.stringify(state)
      ) {
        localStorage.removeItem(`workspace-local-dirty-${pending.id}`)
      }
      setRegistry((current) => {
        const record = current.records[pending.id]
        if (!record) return current
        return {
          ...current,
          records: {
            ...current.records,
            [pending.id]: {
              ...record,
              snapshot: state,
              revision: result.revision,
            },
          },
        }
      })
      setOffline(false)
    } catch (error) {
      setOffline(!isApiError(error) || error.status >= 500)
      if (isApiError(error) && error.status === 409) {
        try {
          const latestPending = queuedSave?.id === pending.id ? queuedSave : pending
          const reopened = await post<WorkspaceOpenResult>('/api/workspaces/open', {
            id: pending.id,
            clientId,
            takeover: false,
            snapshot: latestPending.state,
          })
          setEditable(reopened.editable)
          if (reopened.editable) {
            const serverState = sanitizePersistedWorkspaceState(reopened.record.snapshot)
            const base = readSyncedState(pending.id)
            const rebased = base
              ? mergeWorkspaceConflict(base, latestPending.state, serverState)
              : serverState
            const nextRevision = reopened.record.revision
            setRevision(nextRevision)
            localStorage.setItem(`workspace-revision-${pending.id}`, String(nextRevision))
            localStorage.setItem(`workspace-synced-${pending.id}`, JSON.stringify(serverState))
            if (options.workspaceId() === pending.id) setWorkspaceIfChanged(rebased)
            queuedSave =
              JSON.stringify(rebased) === JSON.stringify(serverState)
                ? null
                : { id: pending.id, state: rebased, currentRevision: nextRevision }
            if (!queuedSave) {
              localStorage.removeItem(`workspace-local-dirty-${pending.id}`)
              localStorage.removeItem(`workspace-offline-${pending.id}`)
            }
            return completedRevision
          }
        } catch {
          setEditable(false)
        }
      }
      localStorage.setItem(
        `workspace-offline-${pending.id}`,
        JSON.stringify({ revision: pending.currentRevision, state }),
      )
    }
    return completedRevision
  }

  async function drainSaves() {
    setSaving(true)
    try {
      while (queuedSave) {
        const pending = queuedSave
        queuedSave = null
        const completedRevision = await persistOne(pending)
        const nextSave = currentQueuedSave()
        if (nextSave && nextSave.id === pending.id && completedRevision != null) {
          queuedSave = { ...nextSave, currentRevision: completedRevision }
        }
      }
    } finally {
      setSaving(false)
    }
  }

  function enqueuePersist(pending: PendingSave) {
    queuedSave = pending
    if (!saveDrain) {
      const drain = drainSaves()
      saveDrain = drain
      void drain.then(
        () => {
          if (saveDrain !== drain) return
          saveDrain = null
          if (queuedSave) void enqueuePersist(queuedSave)
        },
        () => {
          if (saveDrain === drain) saveDrain = null
        },
      )
    }
    return saveDrain ?? Promise.resolve()
  }

  async function refresh() {
    const sequence = ++refreshSequence
    try {
      const value = sanitizeRegistry(
        await api<WorkspaceRegistry>(`/api/workspaces?clientId=${encodeURIComponent(clientId)}`),
      )
      if (sequence !== refreshSequence) return registry()
      setRegistry(value)
      const id = options.workspaceId()
      const record = value.records[id]
      if (record && openedId() === id && !editable()) {
        setRevision(record.revision)
        setWorkspaceIfChanged(record.snapshot)
      }
      if (record && openedId() === id && editable() && !queuedSave && !saveDrain) {
        const offlineState = localStorage.getItem(`workspace-offline-${id}`)
        if (offlineState) {
          try {
            const stored = JSON.parse(offlineState) as unknown
            const storedRecord =
              stored && typeof stored === 'object' && 'state' in stored
                ? (stored as { revision?: unknown; state: unknown })
                : {
                    revision: Number(localStorage.getItem(`workspace-revision-${id}`)),
                    state: stored,
                  }
            const parsed = normalizePersistedWorkspaceState(storedRecord.state, {
              reconcileSnapZones: false,
            })
            if (parsed) {
              const base = readSyncedState(id)
              const retryState =
                storedRecord.revision === record.revision
                  ? parsed
                  : base
                    ? mergeWorkspaceConflict(base, parsed, record.snapshot)
                    : record.snapshot
              localStorage.setItem(`workspace-synced-${id}`, JSON.stringify(record.snapshot))
              void enqueuePersist({
                id,
                state: retryState,
                currentRevision: record.revision,
              })
            } else {
              localStorage.removeItem(`workspace-offline-${id}`)
            }
          } catch {
            localStorage.removeItem(`workspace-offline-${id}`)
          }
        }
      }
      setReady(true)
      setOffline(false)
      return value
    } catch {
      setReady(true)
      setOffline(true)
      return registry()
    }
  }

  async function open(id: string, initial: PersistedWorkspaceState, takeover = false) {
    if (!id || openingId === id) return null
    openingId = id
    const sequence = ++openSequence
    const initialSnapshot = toPersistentWorkspaceState(initial)
    try {
      const result = await post<WorkspaceOpenResult>('/api/workspaces/open', {
        id,
        clientId,
        takeover,
        snapshot: initialSnapshot,
      })
      if (sequence !== openSequence || options.workspaceId() !== id) return null
      const serverSnapshot = sanitizePersistedWorkspaceState(result.record.snapshot)
      const current = options.workspace()
      const currentSnapshot = current ? toPersistentWorkspaceState(current) : initialSnapshot
      const currentChanged = JSON.stringify(currentSnapshot) !== JSON.stringify(initialSnapshot)
      const localCandidate = currentChanged && current ? current : initial
      setOpenedId(id)
      setRevision(result.record.revision)
      setEditable(result.editable)
      setOffline(false)
      const localRevisionValue = localStorage.getItem(`workspace-revision-${id}`)
      const localUpdatedAt = Number(localStorage.getItem(`workspace-local-updated-${id}`) ?? 0)
      const localDirty = localStorage.getItem(`workspace-local-dirty-${id}`) === '1'
      const localState = JSON.stringify(toPersistentWorkspaceState(localCandidate))
      const syncedState = localStorage.getItem(`workspace-synced-${id}`)
      const useLocal =
        result.editable &&
        (currentChanged ||
          localDirty ||
          localUpdatedAt > result.record.updatedAt ||
          (syncedState != null && syncedState !== localState) ||
          (localRevisionValue != null && Number(localRevisionValue) === result.record.revision))
      setWorkspaceIfChanged(useLocal ? localCandidate : serverSnapshot)
      if (!useLocal) {
        localStorage.setItem(`workspace-revision-${id}`, String(result.record.revision))
        localStorage.setItem(`workspace-synced-${id}`, JSON.stringify(serverSnapshot))
      } else if (
        JSON.stringify(toPersistentWorkspaceState(localCandidate)) !==
        JSON.stringify(serverSnapshot)
      ) {
        void enqueuePersist({
          id,
          state: structuredClone(toPersistentWorkspaceState(localCandidate)),
          currentRevision: result.record.revision,
        })
      }
      await refresh()
      return result
    } catch {
      if (options.workspaceId() === id) {
        setOpenedId(id)
        setEditable(true)
        setOffline(true)
      }
      return null
    } finally {
      if (openingId === id) openingId = ''
    }
  }

  createEffect(
    () => ({
      id: options.workspaceId(),
      state: options.workspace(),
      openedId: openedId(),
    }),
    ({ id, state, openedId: currentOpenedId }) => {
      if (!id || !state || currentOpenedId === id) return
      void open(id, state)
    },
  )

  createEffect(
    () => {
      const id = options.workspaceId()
      const state = options.workspace()
      const blocked = options.savingBlocked?.() ?? false
      if (!id || openedId() !== id || !state || !editable() || blocked) return null
      return {
        id,
        state: structuredClone(snapshot(state)),
        currentRevision: untrack(revision),
      }
    },
    (pending) => {
      if (!pending) return undefined
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = undefined
        void enqueuePersist(pending)
      }, 300)
      return () => {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = undefined
      }
    },
  )

  async function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    const id = options.workspaceId()
    const state = options.workspace()
    if (id && openedId() === id && state && editable()) {
      const pending = {
        id,
        state: structuredClone(snapshot(state)),
        currentRevision: revision(),
      }
      await enqueuePersist(pending)
    }
    while (saveDrain || queuedSave) {
      if (saveDrain) await saveDrain
      else await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
  }

  async function heartbeat() {
    const id = options.workspaceId()
    if (!id || openedId() !== id || !editable() || offline()) return
    try {
      await post('/api/workspaces/heartbeat', { id, clientId })
    } catch (error) {
      if (isApiError(error) && error.status === 409) setEditable(false)
    }
  }

  async function bootstrap() {
    await migrateLocalWorkspaces()
    await refresh()
  }

  onSettled(() => {
    void bootstrap()
    const refreshTimer = setInterval(() => void refresh(), 3_000)
    const heartbeatTimer = setInterval(() => void heartbeat(), 5_000)
    return () => {
      clearInterval(refreshTimer)
      clearInterval(heartbeatTimer)
    }
  })

  async function updateMetadata(update: { name?: string; icon?: string; iconColor?: string }) {
    return updateMetadataFor(options.workspaceId(), update)
  }

  async function updateMetadataFor(
    id: string,
    update: { name?: string; icon?: string; iconColor?: string },
  ) {
    const write = metadataWrite
      .catch(() => undefined)
      .then(async () => {
        const previous = untrack(() => registry().records[id])
        if (!previous) return
        setRegistry((current) => ({
          ...current,
          records: { ...current.records, [id]: { ...previous, ...update } },
        }))
        try {
          const result = await post<{ record: WorkspaceRecord }>('/api/workspaces/metadata', {
            id,
            clientId,
            ...update,
          })
          setRegistry((current) => ({
            ...current,
            records: {
              ...current.records,
              [id]: sanitizeRecord(result.record),
            },
          }))
        } catch (error) {
          setRegistry((current) => ({
            ...current,
            records: { ...current.records, [id]: previous },
          }))
          throw error
        }
      })
    metadataWrite = write.catch(() => undefined)
    return write
  }

  async function acquire(id: string, initial: PersistedWorkspaceState) {
    const result = await post<WorkspaceOpenResult>('/api/workspaces/open', {
      id,
      clientId,
      takeover: false,
      snapshot: toPersistentWorkspaceState(initial),
    })
    return { ...result, record: sanitizeRecord(result.record) }
  }

  function adoptOpen(id: string, result: WorkspaceOpenResult) {
    const record = sanitizeRecord(result.record)
    setRegistry((current) => ({
      ...current,
      order: current.order.includes(id) ? current.order : [...current.order, id],
      records: { ...current.records, [id]: record },
    }))
    setOpenedId(id)
    setRevision(record.revision)
    setEditable(result.editable)
    setOffline(false)
  }

  async function reorder(order: string[]) {
    await post('/api/workspaces/reorder', { order })
    setRegistry((current) => ({ ...current, order }))
  }

  async function deleteWorkspace(id: string) {
    await post('/api/workspaces/delete', { id, clientId })
    await refresh()
  }

  return {
    clientId,
    registry,
    ready,
    opened: () => openedId() === options.workspaceId(),
    editable,
    offline,
    saving,
    refresh,
    open,
    takeControl: () => {
      const id = options.workspaceId()
      const state = options.workspace()
      if (id && state) {
        setOpenedId('')
        void open(id, state, true)
      }
    },
    updateMetadata,
    updateMetadataFor,
    flushMetadata: () => metadataWrite,
    flush,
    acquire,
    adoptOpen,
    reorder,
    deleteWorkspace,
    revision,
    setRevision,
    setEditable,
  }
}
