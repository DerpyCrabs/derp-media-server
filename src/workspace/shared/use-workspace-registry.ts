import { api, isApiError, post } from '@/lib/api/client'
import { shareWorkspaceReferences } from '@/workspace/model/workspace-references'
import {
  sanitizePersistedWorkspaceState,
  toPersistentWorkspaceState,
  type PersistedWorkspaceState,
} from '@/workspace/model/use-workspace'
import {
  workspaceClientId,
  type WorkspaceOpenResult,
  type WorkspaceMoveInput,
  type WorkspaceRecord,
  type WorkspaceRegistry,
} from '@/workspace/model/workspace-registry'
import {
  convertWorkspaceSnapshot,
  type WorkspaceType,
} from '@/workspace/model/workspace-conversion'
import type { WorkspaceViewport } from '@/workspace/model/workspace-placement'
import {
  createWorkspaceOperationCoordinator,
  createWorkspaceSaveCoordinator,
  type PendingWorkspaceSave,
} from './workspace-persistence'
import {
  createEffect,
  createSignal,
  onSettled,
  untrack,
  type Accessor,
  type Setter,
} from 'solid-js'

const EMPTY_REGISTRY: WorkspaceRegistry = {
  version: 1,
  order: [],
  records: {},
}

export type WorkspaceActiveSession = {
  id: string
  phase: 'idle' | 'opening' | 'open' | 'failed'
  document: PersistedWorkspaceState | null
  revision: number
  editable: boolean
}

const IDLE_SESSION: WorkspaceActiveSession = {
  id: '',
  phase: 'idle',
  document: null,
  revision: 0,
  editable: false,
}

export type WorkspaceRegistryHttp = {
  api: typeof api
  post: typeof post
}

export type WorkspaceSaveError = {
  workspaceId: string
  message: string
  retryable: boolean
  takeover: boolean
}

export type WorkspaceRegistryOptions = {
  workspaceId: Accessor<string>
  savingBlocked?: Accessor<boolean>
  waitUntilSavingUnblocked?: () => Promise<void>
  http?: WorkspaceRegistryHttp
  clientId?: string
}

type WorkspaceSavePayload = {
  document: PersistedWorkspaceState
  metadata: { name: string | null; icon: string | null; iconColor: string | null }
}

type PendingSave = PendingWorkspaceSave<WorkspaceSavePayload>

function sameWorkspace(left: PersistedWorkspaceState, right: PersistedWorkspaceState) {
  return (
    JSON.stringify(toPersistentWorkspaceState(left)) ===
    JSON.stringify(toPersistentWorkspaceState(right))
  )
}

export function useWorkspaceRegistry(options: WorkspaceRegistryOptions) {
  const clientId = options.clientId ?? workspaceClientId()
  const http = options.http ?? { api, post }
  const operations = createWorkspaceOperationCoordinator()
  const [registry, setRegistry] = createSignal<WorkspaceRegistry>(EMPTY_REGISTRY)
  const [active, setActive] = createSignal<WorkspaceActiveSession>(IDLE_SESSION)
  const [ready, setReady] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<WorkspaceSaveError | null>(null)
  const deferredSaves = new Map<string, PendingSave>()
  const tombstones = new Set<string>()
  let activeSaveCount = 0
  let refreshSequence = 0
  let activationSequence = 0
  let activationTail: Promise<void> = Promise.resolve()

  function currentRevision(id: string, fallback = 0) {
    const current = active()
    if (current.id === id) return Math.max(current.revision, fallback)
    return Math.max(registry().records[id]?.revision ?? 0, fallback)
  }

  function sanitizeRecord(record: WorkspaceRecord): WorkspaceRecord {
    return { ...record, snapshot: sanitizePersistedWorkspaceState(record.snapshot) }
  }

  function sanitizeRegistry(value: WorkspaceRegistry): WorkspaceRegistry {
    return {
      ...value,
      records: Object.fromEntries(
        Object.entries(value.records).map(([id, record]) => [id, sanitizeRecord(record)]),
      ),
    }
  }

  function setRegistryRecord(record: WorkspaceRecord) {
    const next = sanitizeRecord(record)
    setRegistry((current) => {
      const previous = current.records[next.id]
      if (previous && previous.revision > next.revision) return current
      return {
        ...current,
        order: current.order.includes(next.id) ? current.order : [...current.order, next.id],
        records: { ...current.records, [next.id]: next },
      }
    })
  }

  function patchActive(
    id: string,
    update: (current: WorkspaceActiveSession) => WorkspaceActiveSession,
  ) {
    setActive((current) => (current.id === id ? update(current) : current))
  }

  function replaceActiveDocument(id: string, next: PersistedWorkspaceState) {
    setActive((current) => {
      if (current.id !== id || current.phase !== 'open') return current
      const document =
        current.document && sameWorkspace(current.document, next)
          ? current.document
          : current.document
            ? shareWorkspaceReferences(current.document, next)
            : structuredClone(next)
      return { ...current, document }
    })
  }

  function enqueueDocument(id: string, document: PersistedWorkspaceState, revision: number) {
    const record = registry().records[id]
    const pending: PendingSave = {
      id,
      state: {
        document: structuredClone(toPersistentWorkspaceState(document)),
        metadata: {
          name: record?.name ?? null,
          icon: record?.icon ?? null,
          iconColor: record?.iconColor ?? null,
        },
      },
      revision,
    }
    if (options.savingBlocked?.()) deferredSaves.set(id, pending)
    else saveCoordinator.enqueue(pending)
  }

  function reconcileRegistry(incoming: WorkspaceRegistry) {
    const current = registry()
    const records = Object.fromEntries(
      Object.entries(incoming.records).map(([id, remote]) => {
        const local = current.records[id]
        const pending = deferredSaves.get(id) ?? saveCoordinator.pending(id)
        if (pending) {
          const next: WorkspaceRecord = {
            ...remote,
            snapshot: pending.state.document,
            revision: Math.max(remote.revision, local?.revision ?? 0),
          }
          for (const key of ['name', 'icon', 'iconColor'] as const) {
            const value = pending.state.metadata[key]
            if (value === null) delete next[key]
            else next[key] = value
          }
          return [id, next]
        }
        return [id, local && local.revision > remote.revision ? local : remote]
      }),
    )
    return { ...incoming, records }
  }

  async function refreshRegistry() {
    const sequence = ++refreshSequence
    try {
      const incoming = sanitizeRegistry(
        await http.api<WorkspaceRegistry>(
          `/api/workspaces?clientId=${encodeURIComponent(clientId)}`,
        ),
      )
      if (sequence !== refreshSequence) return { value: registry(), applied: false }
      const value = reconcileRegistry(incoming)
      setRegistry(value)

      const current = active()
      const record = value.records[current.id]
      if (current.phase === 'open' && record) {
        const localSavePending =
          !!saveCoordinator.pending(current.id) || deferredSaves.has(current.id)
        const lockChanged = record.locked === true || !current.editable
        const newerAcceptedSnapshot = record.revision > current.revision && !localSavePending
        if (lockChanged || newerAcceptedSnapshot) {
          setActive({
            ...current,
            document: localSavePending
              ? current.document
              : shareWorkspaceReferences(current.document ?? record.snapshot, record.snapshot),
            revision: record.revision,
            editable: current.editable && record.locked !== true,
          })
        }
      }
      setReady(true)
      return { value, applied: true }
    } catch {
      if (sequence === refreshSequence) setReady(true)
      return { value: registry(), applied: false }
    }
  }

  async function refresh() {
    return (await refreshRegistry()).value
  }

  async function persistOne(pending: PendingSave) {
    if (tombstones.has(pending.id)) return {}
    const snapshot = toPersistentWorkspaceState(pending.state.document)
    const revisionAtQueue = currentRevision(pending.id, pending.revision)
    activeSaveCount += 1
    setSaving(true)
    try {
      const result = await operations.run(pending.id, () =>
        http.post<{ revision: number }>('/api/workspaces/save', {
          id: pending.id,
          clientId,
          revision: revisionAtQueue,
          snapshot,
          metadata: pending.state.metadata,
        }),
      )
      const revision = result.revision
      setRegistry((current) => {
        const record = current.records[pending.id]
        if (!record || record.revision > revision) return current
        const nextRecord: WorkspaceRecord = {
          ...record,
          snapshot,
          revision,
        }
        for (const key of ['name', 'icon', 'iconColor'] as const) {
          const value = pending.state.metadata[key]
          if (value === null) delete nextRecord[key]
          else nextRecord[key] = value
        }
        return {
          ...current,
          records: {
            ...current.records,
            [pending.id]: nextRecord,
          },
        }
      })
      patchActive(pending.id, (current) => ({
        ...current,
        revision: Math.max(current.revision, revision),
      }))
      return { revision }
    } finally {
      activeSaveCount = Math.max(0, activeSaveCount - 1)
      setSaving(activeSaveCount > 0)
    }
  }

  const saveCoordinator = createWorkspaceSaveCoordinator<WorkspaceSavePayload>({
    save: async (pending) => {
      try {
        const result = await persistOne(pending)
        const recovering = saveError()?.workspaceId === pending.id
        setSaveError((current) => (current?.workspaceId === pending.id ? null : current))
        if (recovering) patchActive(pending.id, (current) => ({ ...current, editable: true }))
        return result
      } catch (error) {
        const retryable = !isApiError(error) || error.status >= 500
        setSaveError({
          workspaceId: pending.id,
          message: error instanceof Error ? error.message : 'Could not save workspace',
          retryable,
          takeover:
            isApiError(error) &&
            error.status === 409 &&
            error.message === 'Workspace is open elsewhere',
        })
        patchActive(pending.id, (current) => ({ ...current, editable: false }))
        if (!retryable) await refreshRegistry()
        throw error
      }
    },
  })

  async function retrySave() {
    const failure = saveError()
    if (!failure?.retryable) return
    try {
      await saveCoordinator.retry(failure.workspaceId)
    } catch {}
  }

  async function takeControl() {
    const current = active()
    if (!current.id) return
    const authoritative = registry().records[current.id]?.snapshot ?? current.document
    if (!authoritative) return
    const pending = saveCoordinator.pending(current.id)
    const result = await openWorkspace(current.id, authoritative, true)
    setActive((latest) => {
      if (latest.id !== current.id) return latest
      return {
        ...latest,
        phase: 'open',
        document: pending ? latest.document : structuredClone(result.record.snapshot),
        revision: result.record.revision,
        editable: result.editable,
      }
    })
    if (pending) {
      try {
        await saveCoordinator.retry(current.id)
      } catch {}
    } else {
      setSaveError((failure) => (failure?.workspaceId === current.id ? null : failure))
    }
  }

  function queueActivation<T>(operation: () => Promise<T>) {
    const result = activationTail.catch(() => undefined).then(operation)
    activationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function waitForSavingReady() {
    if (!(options.savingBlocked?.() ?? false)) return
    await options.waitUntilSavingUnblocked?.()
  }

  async function flushWorkspace(id: string) {
    await waitForSavingReady()
    const deferred = deferredSaves.get(id)
    if (deferred) {
      deferredSaves.delete(id)
      saveCoordinator.enqueue(deferred)
    }
    await saveCoordinator.flush(id)
  }

  async function flush() {
    const id = active().id
    if (id) await flushWorkspace(id)
  }

  async function releaseLease(id: string) {
    await operations.run(id, () => http.post('/api/workspaces/release', { id, clientId }))
  }

  async function closeActive(afterFlush?: () => Promise<void>) {
    await waitForSavingReady()
    const departing = active()
    if (departing.phase === 'idle' || !departing.id) {
      await afterFlush?.()
      return
    }
    patchActive(departing.id, (current) => ({ ...current, editable: false }))
    try {
      await flushWorkspace(departing.id)
      await afterFlush?.()
    } catch (error) {
      patchActive(departing.id, (current) => ({ ...current, editable: departing.editable }))
      throw error
    }
    if (!tombstones.has(departing.id)) {
      try {
        await releaseLease(departing.id)
      } catch {}
    }
    if (active().id === departing.id) setActive(IDLE_SESSION)
  }

  async function leaveActive() {
    await closeActive()
  }

  async function openWorkspace(id: string, initial: PersistedWorkspaceState, takeover = false) {
    const result = await operations.run(id, () =>
      http.post<WorkspaceOpenResult>('/api/workspaces/open', {
        id,
        clientId,
        takeover,
        snapshot: toPersistentWorkspaceState(initial),
      }),
    )
    const record = sanitizeRecord(result.record)
    setRegistryRecord(record)
    return { ...result, record }
  }

  async function activateNow(
    id: string,
    initial: PersistedWorkspaceState,
    takeover: boolean,
    sequence: number,
  ) {
    if (
      !id ||
      id !== options.workspaceId() ||
      tombstones.has(id) ||
      sequence !== activationSequence
    ) {
      return null
    }
    const current = active()
    if (current.id === id && current.phase === 'open' && !takeover) return null
    if (current.id && current.id !== id) await leaveActive()
    if (takeover && current.id === id && current.phase === 'open') await leaveActive()
    setActive({
      id,
      phase: 'opening',
      document: null,
      revision: registry().records[id]?.revision ?? 0,
      editable: false,
    })
    try {
      const result = await operations.run(id, () =>
        http.post<WorkspaceOpenResult>('/api/workspaces/open', {
          id,
          clientId,
          takeover,
          snapshot: toPersistentWorkspaceState(initial),
        }),
      )
      if (sequence !== activationSequence || id !== options.workspaceId() || tombstones.has(id)) {
        if (result.editable) {
          try {
            await releaseLease(id)
          } catch {}
        }
        return null
      }
      const record = sanitizeRecord(result.record)
      setRegistryRecord(record)
      setActive({
        id,
        phase: 'open',
        document: structuredClone(record.snapshot),
        revision: record.revision,
        editable: result.editable,
      })
      await refreshRegistry()
      return { ...result, record }
    } catch {
      if (sequence === activationSequence && id === options.workspaceId()) {
        setActive({ ...IDLE_SESSION, id, phase: 'failed' })
      }
      return null
    }
  }

  function activate(id: string, initial: PersistedWorkspaceState, takeover = false) {
    if (id !== options.workspaceId()) return Promise.resolve(null)
    const sequence = ++activationSequence
    return queueActivation(() => untrack(() => activateNow(id, initial, takeover, sequence)))
  }

  async function reconcileRemoteChange() {
    const refreshed = await refresh()
    const failed = active()
    if (failed.phase === 'failed' && failed.id === options.workspaceId()) {
      const record = refreshed.records[failed.id]
      if (record) await activate(failed.id, record.snapshot)
    }
    return refreshed
  }

  async function transition(action: () => void, afterFlush?: () => Promise<void>) {
    ++activationSequence
    await queueActivation(async () => {
      await untrack(() => closeActive(afterFlush))
      untrack(action)
    })
  }

  const document: Accessor<PersistedWorkspaceState | null> = () => {
    const current = active()
    return current.id === options.workspaceId() && current.phase === 'open'
      ? current.document
      : null
  }

  const editable = () => {
    const current = active()
    return current.id === options.workspaceId() && current.phase === 'open' && current.editable
  }

  const update: Setter<PersistedWorkspaceState | null> = (value) => {
    let result: PersistedWorkspaceState | null = null
    setActive((current) => {
      result = current.document
      if (
        current.id !== options.workspaceId() ||
        current.phase !== 'open' ||
        !current.editable ||
        !current.document ||
        tombstones.has(current.id)
      ) {
        return current
      }
      const next =
        typeof value === 'function'
          ? (value as (state: PersistedWorkspaceState | null) => PersistedWorkspaceState | null)(
              current.document,
            )
          : value
      if (!next || sameWorkspace(next, current.document)) return current
      result = next
      enqueueDocument(current.id, next, current.revision)
      return { ...current, document: next }
    })
    return result
  }

  function replace(value: PersistedWorkspaceState | null) {
    const current = active()
    if (current.id !== options.workspaceId() || current.phase !== 'open') return current.document
    if (!value) {
      setActive({ ...current, document: null })
      return null
    }
    replaceActiveDocument(current.id, value)
    return value
  }

  createEffect(
    () => options.savingBlocked?.() ?? false,
    (blocked) => {
      if (blocked) return
      for (const pending of deferredSaves.values()) saveCoordinator.enqueue(pending)
      deferredSaves.clear()
    },
  )

  async function heartbeat() {
    const current = active()
    if (current.phase !== 'open' || !current.id || !current.editable) return
    try {
      await operations.run(current.id, () =>
        http.post('/api/workspaces/heartbeat', { id: current.id, clientId }),
      )
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        patchActive(current.id, (latest) => ({ ...latest, editable: false }))
      }
    }
  }

  onSettled(() => {
    void refresh()
    const refreshTimer = setInterval(() => void refresh(), 3_000)
    const heartbeatTimer = setInterval(() => void heartbeat(), 5_000)
    return () => {
      clearInterval(refreshTimer)
      clearInterval(heartbeatTimer)
    }
  })

  async function updateMetadataFor(
    id: string,
    update: { name?: string; icon?: string; iconColor?: string },
  ) {
    if (!id || tombstones.has(id)) return
    const record = registry().records[id]
    if (!record) return
    const next = { ...record }
    for (const key of ['name', 'icon', 'iconColor'] as const) {
      if (!Object.hasOwn(update, key)) continue
      const value = update[key]?.trim()
      if (value) next[key] = value
      else delete next[key]
    }
    setRegistryRecord(next)
    const current = active()
    enqueueDocument(
      id,
      current.id === id && current.document ? current.document : record.snapshot,
      record.revision,
    )
    await saveCoordinator.flush(id)
  }

  async function acquire(id: string, initial: PersistedWorkspaceState) {
    return openWorkspace(id, initial)
  }

  async function convertWorkspace(id: string, target: WorkspaceType, viewport: WorkspaceViewport) {
    const isActive = active().id === id
    if (isActive) await flushWorkspace(id)
    let record = registry().records[id]
    if (!record) return
    let releaseAfter = false
    if (!isActive) {
      const opened = await openWorkspace(id, record.snapshot)
      if (!opened.editable) throw new Error('Workspace is open elsewhere.')
      record = opened.record
      releaseAfter = true
    }
    const snapshot = convertWorkspaceSnapshot(record.snapshot, target, viewport)
    try {
      const result = await operations.run(id, () =>
        http.post<{ revision: number }>('/api/workspaces/convert', {
          id,
          clientId,
          revision: record.revision,
          snapshot,
        }),
      )
      const next = { ...record, snapshot, revision: result.revision }
      setRegistryRecord(next)
      if (isActive) {
        setActive((current) =>
          current.id === id
            ? { ...current, document: snapshot, revision: result.revision, editable: true }
            : current,
        )
      }
    } finally {
      if (releaseAfter) await releaseLease(id).catch(() => {})
    }
  }

  async function moveWorkspaces(input: WorkspaceMoveInput) {
    await flush()
    const sourceSnapshot = sanitizePersistedWorkspaceState(input.sourceSnapshot)
    const destinationSnapshot = sanitizePersistedWorkspaceState(input.destinationSnapshot)
    const result = await operations.run([input.sourceId, input.destinationId], () =>
      http.post<{ sourceRevision: number; destinationRevision: number }>('/api/workspaces/move', {
        ...input,
        clientId,
        sourceRevision: input.sourceRevision,
        destinationRevision: input.destinationRevision,
        sourceSnapshot,
        destinationSnapshot,
      }),
    )
    await refresh()
    if (input.deleteSource) {
      tombstones.add(input.sourceId)
      saveCoordinator.clear(input.sourceId)
      if (active().id === input.sourceId) setActive(IDLE_SESSION)
    } else if (active().id === input.sourceId) {
      setActive((current) => ({
        ...current,
        document: sourceSnapshot,
        revision: result.sourceRevision,
      }))
    }
    return result
  }

  async function reorder(order: string[]) {
    await operations.run('__registry__', () => http.post('/api/workspaces/reorder', { order }))
    setRegistry((current) => ({ ...current, order }))
  }

  async function deleteWorkspace(id: string) {
    if (!id || tombstones.has(id)) return
    tombstones.add(id)
    try {
      if (active().id === id) await flushWorkspace(id)
      await operations.run(id, () => http.post('/api/workspaces/delete', { id, clientId }))
      if (active().id === id) setActive(IDLE_SESSION)
      await refresh()
    } catch (error) {
      tombstones.delete(id)
      throw error
    }
  }

  return {
    clientId,
    registry,
    active,
    ready,
    document,
    update,
    replace,
    opened: () => {
      const current = active()
      return current.id === options.workspaceId() && current.phase === 'open'
    },
    editable,
    saving,
    saveError,
    retrySave,
    revision: () => {
      const current = active()
      return current.id === options.workspaceId() ? current.revision : 0
    },
    deleted: (id: string) => tombstones.has(id),
    refresh,
    reconcileRemoteChange,
    activate,
    takeControl,
    updateMetadata: (update: { name?: string; icon?: string; iconColor?: string }) =>
      updateMetadataFor(options.workspaceId(), update),
    updateMetadataFor,
    flush,
    transition,
    acquire,
    release: releaseLease,
    moveWorkspaces,
    convertWorkspace,
    reorder,
    deleteWorkspace,
  }
}
