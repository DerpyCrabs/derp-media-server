import {
  workspaceRegistrySchema,
  workspaceOpenSchema,
  workspaceRevisionSchema,
  workspaceMoveSchema,
} from '../model/workspace-schemas'
import { createWorkspaceSaveJournal, type WorkspaceSavePayload } from './workspace-save-journal'
import {
  isApiError,
  apiEffect,
  postEffect,
  apiSchemaEffect,
  postSchemaEffect,
} from '@/lib/api/client'
import { shareWorkspaceReferences } from '@/workspace/model/workspace-references'
import {
  sanitizePersistedWorkspaceState,
  toPersistentWorkspaceState,
  type PersistedWorkspaceState,
} from '@/workspace/model/workspace'
import {
  workspaceClientId,
  type WorkspaceMoveInput,
  type WorkspaceRecord,
  type WorkspaceRegistry,
} from '@/workspace/model/workspace-registry'
import {
  convertWorkspaceSnapshot,
  type WorkspaceType,
} from '@/workspace/model/workspace-conversion'
import type { WorkspaceViewport } from '@/workspace/model/workspace-placement'
import { transferWorkspaceGroups } from '@/workspace/model/workspace-transfer'
import {
  createWorkspaceOperationCoordinator,
  createWorkspaceSaveCoordinator,
  type PendingWorkspaceSave,
} from './workspace-persistence'
import { modelOwner } from 'effectweb'
import { Effect, Exit, Semaphore, Schema } from 'effect'
type Accessor<T> = () => T
type Setter<T> = (value: T | ((current: T) => T)) => T
const EMPTY_REGISTRY: WorkspaceRegistry = { version: 1, order: [], records: {} }
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
  api: (url: string) => Effect.Effect<unknown, unknown>
  post: (url: string, body: unknown) => Effect.Effect<unknown, unknown>
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
  waitUntilSavingUnblocked?: () => Effect.Effect<void, unknown>
  http?: WorkspaceRegistryHttp
  clientId?: string
  saveStorage?: Storage | null
}
type PendingSave = PendingWorkspaceSave<WorkspaceSavePayload>
export type WorkspaceSessionTransferInput = {
  sourceId: string
  destinationId: string
  destinationFallback: PersistedWorkspaceState
  windowIds: string[]
  viewport: WorkspaceViewport
}
function sameWorkspace(left: PersistedWorkspaceState, right: PersistedWorkspaceState) {
  return (
    JSON.stringify(toPersistentWorkspaceState(left)) ===
    JSON.stringify(toPersistentWorkspaceState(right))
  )
}
export function createWorkspaceRegistry(options: WorkspaceRegistryOptions) {
  const clientId = options.clientId ?? workspaceClientId()
  const http = options.http ?? { api: apiEffect, post: postEffect }
  const getDecoded = <A>(schema: Schema.Codec<A>, url: string) =>
    options.http
      ? http.api(url).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)))
      : apiSchemaEffect(schema, url)
  const postDecoded = <A>(schema: Schema.Codec<A>, url: string, body: unknown) =>
    options.http
      ? http.post(url, body).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)))
      : postSchemaEffect(schema, url, body)
  const saveJournal = createWorkspaceSaveJournal(
    options.saveStorage === undefined
      ? typeof sessionStorage === 'undefined'
        ? null
        : sessionStorage
      : options.saveStorage,
    clientId,
  )
  const operations = createWorkspaceOperationCoordinator()
  const owner = modelOwner({
    registry: EMPTY_REGISTRY,
    active: IDLE_SESSION,
    ready: false,
    saving: false,
    saveError: null as WorkspaceSaveError | null,
  })
  const registry = () => owner.read().registry
  const active = () => owner.read().active
  const ready = () => owner.read().ready
  const saving = () => owner.read().saving
  const saveError = () => owner.read().saveError
  const setRegistry: Setter<WorkspaceRegistry> = (value) => {
    const next = typeof value === 'function' ? value(registry()) : value
    owner.patch({ registry: next })
    return next
  }
  const setActive: Setter<WorkspaceActiveSession> = (value) => {
    const next = typeof value === 'function' ? value(active()) : value
    owner.patch({ active: next })
    return next
  }
  const setReady = (ready: boolean) => owner.patch({ ready })
  const setSaving = (saving: boolean) => owner.patch({ saving })
  const setSaveError: Setter<WorkspaceSaveError | null> = (value) => {
    const saveError = typeof value === 'function' ? value(owner.read().saveError) : value
    owner.patch({ saveError })
    return saveError
  }
  const deferredSaves = new Map<string, PendingSave>()
  const tombstones = new Set<string>()
  let activeSaveCount = 0
  let refreshSequence = 0
  let activationSequence = 0
  const activationGate = Semaphore.makeUnsafe(1)
  let closing = false
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
    saveJournal.enqueue(pending)
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
  const refreshRegistryEffect = Effect.suspend(() => {
    const sequence = ++refreshSequence
    return getDecoded(
      workspaceRegistrySchema,
      `/api/workspaces?clientId=${encodeURIComponent(clientId)}`,
    ).pipe(
      Effect.map((response) => {
        const incoming = sanitizeRegistry(response)
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
      }),
      Effect.catch(() =>
        Effect.sync(() => {
          if (sequence === refreshSequence) setReady(true)
          return { value: registry(), applied: false }
        }),
      ),
    )
  })
  function refreshRegistry() {
    return refreshRegistryEffect
  }
  const refreshEffect = refreshRegistryEffect.pipe(Effect.map((result) => result.value))
  function refresh() {
    return refreshEffect
  }
  function persistOne(pending: PendingSave) {
    return Effect.gen(function* () {
      if (tombstones.has(pending.id)) return {}
      const snapshot = toPersistentWorkspaceState(pending.state.document)
      const revisionAtQueue = currentRevision(pending.id, pending.revision)
      activeSaveCount += 1
      setSaving(true)
      return yield* Effect.gen(function* () {
        saveJournal.started(pending)
        const result = yield* operations.run(pending.id, () =>
          postDecoded(workspaceRevisionSchema, '/api/workspaces/save', {
            id: pending.id,
            clientId,
            revision: revisionAtQueue,
            snapshot,
            metadata: pending.state.metadata,
          }),
        )
        const revision = result.revision
        saveJournal.acknowledged(pending, revision)
        setRegistry((current) => {
          const record = current.records[pending.id]
          if (!record || record.revision > revision) return current
          const queued = deferredSaves.get(pending.id) ?? saveCoordinator.pending(pending.id)
          const latest = queued?.state ?? pending.state
          const nextRecord: WorkspaceRecord = { ...record, snapshot: latest.document, revision }
          for (const key of ['name', 'icon', 'iconColor'] as const) {
            const value = latest.metadata[key]
            if (value === null) delete nextRecord[key]
            else nextRecord[key] = value
          }
          return { ...current, records: { ...current.records, [pending.id]: nextRecord } }
        })
        patchActive(pending.id, (current) => ({
          ...current,
          revision: Math.max(current.revision, revision),
        }))
        return { revision }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            activeSaveCount = Math.max(0, activeSaveCount - 1)
            setSaving(activeSaveCount > 0)
          }),
        ),
      )
    })
  }
  const saveCoordinator = createWorkspaceSaveCoordinator<WorkspaceSavePayload>({
    save: (pending) =>
      Effect.gen(function* () {
        return yield* Effect.gen(function* () {
          const result = yield* persistOne(pending)
          const recovering = saveError()?.workspaceId === pending.id
          setSaveError((current) => (current?.workspaceId === pending.id ? null : current))
          if (recovering) patchActive(pending.id, (current) => ({ ...current, editable: true }))
          return result
        }).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
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
              if (!retryable) yield* refreshRegistry()
              return yield* Effect.fail(error)
            }),
          ),
        )
      }),
  })
  function retrySave() {
    return Effect.gen(function* () {
      const failure = saveError()
      if (!failure?.retryable) return
      yield* Effect.gen(function* () {
        yield* saveCoordinator.retry(failure.workspaceId)
      }).pipe(Effect.ignore)
    })
  }
  function takeControl() {
    return Effect.gen(function* () {
      const current = active()
      if (!current.id) return
      const authoritative = registry().records[current.id]?.snapshot ?? current.document
      if (!authoritative) return
      const pending = saveCoordinator.pending(current.id)
      const result = yield* openWorkspace(current.id, authoritative, true)
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
        yield* Effect.gen(function* () {
          yield* saveCoordinator.retry(current.id)
        }).pipe(Effect.ignore)
      } else {
        setSaveError((failure) => (failure?.workspaceId === current.id ? null : failure))
      }
    })
  }
  function queueActivation<A, E>(operation: () => Effect.Effect<A, E>) {
    return activationGate.withPermits(1)(Effect.uninterruptible(Effect.suspend(operation)))
  }
  function waitForSavingReady() {
    return Effect.gen(function* () {
      if (!(options.savingBlocked?.() ?? false)) return
      yield* options.waitUntilSavingUnblocked?.() ?? Effect.void
    })
  }
  function flushWorkspace(id: string) {
    return Effect.gen(function* () {
      yield* waitForSavingReady()
      const deferred = deferredSaves.get(id)
      if (deferred) {
        deferredSaves.delete(id)
        saveCoordinator.enqueue(deferred)
      }
      yield* saveCoordinator.flush(id)
    })
  }
  function flush() {
    return Effect.gen(function* () {
      const id = active().id
      if (id) yield* flushWorkspace(id)
    })
  }
  function releaseLease(id: string) {
    return Effect.gen(function* () {
      yield* operations.run(id, () => http.post('/api/workspaces/release', { id, clientId }))
    })
  }
  function closeActive(afterFlush?: () => Effect.Effect<void, unknown>) {
    return Effect.gen(function* () {
      yield* waitForSavingReady()
      const departing = active()
      if (departing.phase === 'idle' || !departing.id) {
        yield* afterFlush?.() ?? Effect.void
        return
      }
      patchActive(departing.id, (current) => ({ ...current, editable: false }))
      yield* Effect.gen(function* () {
        yield* flushWorkspace(departing.id)
        yield* afterFlush?.() ?? Effect.void
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            patchActive(departing.id, (current) => ({ ...current, editable: departing.editable }))
            return yield* Effect.fail(error)
          }),
        ),
      )
      if (!tombstones.has(departing.id)) {
        yield* Effect.gen(function* () {
          yield* releaseLease(departing.id)
        }).pipe(Effect.ignore)
      }
      if (active().id === departing.id) setActive(IDLE_SESSION)
    })
  }
  function leaveActive() {
    return Effect.gen(function* () {
      yield* closeActive()
    })
  }
  function openWorkspace(id: string, initial: PersistedWorkspaceState, takeover = false) {
    return Effect.gen(function* () {
      const result = yield* operations.run(id, () =>
        postDecoded(workspaceOpenSchema, '/api/workspaces/open', {
          id,
          clientId,
          takeover,
          snapshot: toPersistentWorkspaceState(initial),
        }),
      )
      const record = sanitizeRecord(result.record)
      setRegistryRecord(record)
      return { ...result, record }
    })
  }
  function activateNow(
    id: string,
    initial: PersistedWorkspaceState,
    takeover: boolean,
    sequence: number,
    initialMetadata?: { name?: string },
  ) {
    return Effect.gen(function* () {
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
      if (current.id && current.id !== id) yield* leaveActive()
      if (takeover && current.id === id && current.phase === 'open') yield* leaveActive()
      setActive({
        id,
        phase: 'opening',
        document: null,
        revision: registry().records[id]?.revision ?? 0,
        editable: false,
      })
      return yield* Effect.gen(function* () {
        const result = yield* operations.run(id, () =>
          postDecoded(workspaceOpenSchema, '/api/workspaces/open', {
            id,
            clientId,
            takeover,
            snapshot: toPersistentWorkspaceState(initial),
            metadata: initialMetadata,
          }),
        )
        if (sequence !== activationSequence || id !== options.workspaceId() || tombstones.has(id)) {
          if (result.editable) {
            yield* Effect.gen(function* () {
              yield* releaseLease(id)
            }).pipe(Effect.ignore)
          }
          return null
        }
        const record = sanitizeRecord(result.record)
        const recovered = saveJournal.recover(record, result.editable)
        setRegistryRecord(
          recovered
            ? {
                ...record,
                snapshot: recovered.state.document,
                name: recovered.state.metadata.name ?? undefined,
                icon: recovered.state.metadata.icon ?? undefined,
                iconColor: recovered.state.metadata.iconColor ?? undefined,
              }
            : record,
        )
        setActive({
          id,
          phase: 'open',
          document: structuredClone(recovered?.state.document ?? record.snapshot),
          revision: record.revision,
          editable: result.editable,
        })
        if (recovered) {
          saveJournal.enqueue(recovered)
          saveCoordinator.enqueue(recovered)
        }
        yield* refreshRegistry()
        return { ...result, record }
      }).pipe(
        Effect.catch((_error) =>
          Effect.sync(() => {
            if (sequence === activationSequence && id === options.workspaceId()) {
              setActive({ ...IDLE_SESSION, id, phase: 'failed' })
            }
            return null
          }),
        ),
      )
    })
  }
  function activate(
    id: string,
    initial: PersistedWorkspaceState,
    takeover = false,
    initialMetadata?: { name?: string },
  ) {
    return Effect.suspend(() => {
      if (closing || id !== options.workspaceId()) return Effect.succeed(null)
      const sequence = ++activationSequence
      return queueActivation(() => activateNow(id, initial, takeover, sequence, initialMetadata))
    })
  }
  function reconcileRemoteChange() {
    return Effect.gen(function* () {
      const refreshed = yield* refresh()
      const failed = active()
      if (failed.phase === 'failed' && failed.id === options.workspaceId()) {
        const record = refreshed.records[failed.id]
        if (record) yield* activate(failed.id, record.snapshot)
      }
      return refreshed
    })
  }
  function transition(action: () => void, afterFlush?: () => Effect.Effect<void, unknown>) {
    return Effect.gen(function* () {
      ++activationSequence
      yield* queueActivation(() =>
        Effect.gen(function* () {
          yield* closeActive(afterFlush)
          action()
        }),
      )
    })
  }
  const document = () => {
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
  function savingBlockChanged() {
    if (options.savingBlocked?.()) return
    const pendingSaves = [...deferredSaves.values()]
    deferredSaves.clear()
    for (const pending of pendingSaves) saveCoordinator.enqueue(pending)
  }
  const heartbeat = Effect.suspend(() => {
    const current = active()
    if (current.phase !== 'open' || !current.id || !current.editable) return Effect.void
    const body = { id: current.id, clientId }
    const request = http.post('/api/workspaces/heartbeat', body)
    return request.pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        Effect.sync(() => {
          if (isApiError(error) && error.status === 409)
            patchActive(current.id, (latest) => ({ ...latest, editable: false }))
        }),
      ),
    )
  })
  const refreshSlot = 'workspace-registry-refresh'
  const heartbeatSlot = 'workspace-registry-heartbeat'
  const start = () => {
    owner.run(
      refreshSlot,
      Effect.forever(refreshEffect.pipe(Effect.andThen(Effect.sleep(3000)))),
      'drop',
    )
    owner.run(
      heartbeatSlot,
      Effect.forever(Effect.sleep(5000).pipe(Effect.andThen(heartbeat))),
      'drop',
    )
  }
  function updateMetadataFor(
    id: string,
    update: { name?: string; icon?: string; iconColor?: string },
  ) {
    return Effect.gen(function* () {
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
      yield* saveCoordinator.flush(id)
    })
  }
  function convertWorkspace(id: string, target: WorkspaceType, viewport: WorkspaceViewport) {
    return Effect.gen(function* () {
      const isActive = active().id === id
      if (isActive) yield* flushWorkspace(id)
      let record = registry().records[id]
      if (!record) return undefined
      let releaseAfter = false
      if (!isActive) {
        const opened = yield* openWorkspace(id, record.snapshot)
        if (!opened.editable) return yield* Effect.fail(new Error('Workspace is open elsewhere.'))
        record = opened.record
        releaseAfter = true
      }
      const snapshot = convertWorkspaceSnapshot(record.snapshot, target, viewport)
      return yield* Effect.gen(function* () {
        const result = yield* operations.run(id, () =>
          postDecoded(workspaceRevisionSchema, '/api/workspaces/convert', {
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
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            if (releaseAfter) yield* releaseLease(id).pipe(Effect.ignore)
          }),
        ),
      )
    })
  }
  function moveWorkspaces(input: WorkspaceMoveInput) {
    return Effect.gen(function* () {
      yield* flush()
      const sourceSnapshot = sanitizePersistedWorkspaceState(input.sourceSnapshot)
      const destinationSnapshot = sanitizePersistedWorkspaceState(input.destinationSnapshot)
      const result = yield* operations.run([input.sourceId, input.destinationId], () =>
        postDecoded(workspaceMoveSchema, '/api/workspaces/move', {
          ...input,
          clientId,
          sourceRevision: input.sourceRevision,
          destinationRevision: input.destinationRevision,
          sourceSnapshot,
          destinationSnapshot,
        }),
      )
      yield* refresh()
      if (input.deleteSource) {
        tombstones.add(input.sourceId)
        saveCoordinator.clear(input.sourceId)
        saveJournal.clear(input.sourceId)
        if (active().id === input.sourceId) setActive(IDLE_SESSION)
      } else if (active().id === input.sourceId) {
        setActive((current) => ({
          ...current,
          document: sourceSnapshot,
          revision: result.sourceRevision,
        }))
      }
      return result
    })
  }
  function transferWindows(input: WorkspaceSessionTransferInput) {
    return Effect.gen(function* () {
      const destinationRecord = registry().records[input.destinationId]
      let destinationAcquired = false
      const destinationCreated = !destinationRecord
      let moveStarted = false
      return yield* Effect.gen(function* () {
        const opened = yield* openWorkspace(
          input.destinationId,
          destinationRecord?.snapshot ?? input.destinationFallback,
        )
        if (!opened.editable) return yield* Effect.fail(new Error('Workspace is open elsewhere.'))
        destinationAcquired = true
        yield* flush()
        const source = document()
        if (!source || active().id !== input.sourceId) {
          return yield* Effect.fail(new Error('Workspace is no longer available.'))
        }
        const moved = transferWorkspaceGroups(source, opened.record.snapshot, {
          windowIds: input.windowIds,
          viewport: input.viewport,
        })
        if (moved.source === source)
          return yield* Effect.fail(new Error('Windows are no longer available.'))
        const sourceRecord = registry().records[input.sourceId]
        const deleteSource = !sourceRecord?.name && moved.source.windows.length === 0
        moveStarted = true
        yield* moveWorkspaces({
          sourceId: input.sourceId,
          destinationId: input.destinationId,
          sourceRevision: currentRevision(input.sourceId),
          destinationRevision: opened.record.revision,
          sourceSnapshot: moved.source,
          destinationSnapshot: moved.destination,
          deleteSource,
        })
        destinationAcquired = false
        return { kind: 'moved' as const, destinationId: input.destinationId }
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const rollback = !moveStarted || isApiError(error)
            if (rollback) {
              yield* Effect.gen(function* () {
                if (destinationCreated) yield* deleteWorkspace(input.destinationId)
                else if (destinationAcquired) yield* releaseLease(input.destinationId)
              }).pipe(Effect.ignore)
            }
            return {
              kind: 'failed' as const,
              rollback,
              message:
                error instanceof Error ? error.message : 'Could not move windows to workspace.',
            }
          }),
        ),
      )
    })
  }
  function reorder(order: string[]) {
    return Effect.gen(function* () {
      yield* operations.run('__registry__', () => http.post('/api/workspaces/reorder', { order }))
      setRegistry((current) => ({ ...current, order }))
    })
  }
  function deleteWorkspace(id: string) {
    return Effect.gen(function* () {
      if (!id || tombstones.has(id)) return
      tombstones.add(id)
      yield* Effect.gen(function* () {
        if (active().id === id) yield* flushWorkspace(id)
        yield* operations.run(id, () => http.post('/api/workspaces/delete', { id, clientId }))
        saveJournal.clear(id)
        if (active().id === id) setActive(IDLE_SESSION)
        yield* refresh()
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            tombstones.delete(id)
            return yield* Effect.fail(error)
          }),
        ),
      )
    })
  }
  return {
    source: owner.source,
    start,
    close: () =>
      Effect.suspend(() => {
        closing = true
        ++activationSequence
        owner.cancel(refreshSlot)
        owner.cancel(heartbeatSlot)
        return activationGate
          .withPermits(1)(
            Effect.gen(function* () {
              const activeResult = yield* Effect.exit(closeActive())
              const savesResult = yield* Effect.exit(saveCoordinator.close())
              if (Exit.isFailure(activeResult)) return yield* Effect.failCause(activeResult.cause)
              if (Exit.isFailure(savesResult)) return yield* Effect.failCause(savesResult.cause)
              return undefined
            }),
          )
          .pipe(Effect.ensuring(owner.close().pipe(Effect.orDie)), Effect.uninterruptible)
      }),
    dispose: () => {
      owner.dispose()
      saveCoordinator.dispose()
    },
    savingBlockChanged,
    state: {
      clientId,
      active,
      ready,
      opened: () => {
        const current = active()
        return current.id === options.workspaceId() && current.phase === 'open'
      },
      editable,
      saving,
      saveError,
      revision: () => {
        const current = active()
        return current.id === options.workspaceId() ? current.revision : 0
      },
      deleted: (id: string) => tombstones.has(id),
    },
    document: { value: document, update, replace, retrySave, flush },
    catalog: {
      value: registry,
      refresh,
      reconcileRemoteChange,
      updateMetadata: (update: { name?: string; icon?: string; iconColor?: string }) =>
        updateMetadataFor(options.workspaceId(), update),
      updateMetadataFor,
      reorder,
      delete: deleteWorkspace,
    },
    lifecycle: { activate, takeControl, transition, convert: convertWorkspace },
    transfer: { windows: transferWindows },
  }
}
