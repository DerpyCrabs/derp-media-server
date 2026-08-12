import { ApiError, api } from './api'
import {
  parseSpace,
  parseSpaceOrThrow,
  parseSpaceSummary,
  reduceSpaceCommand,
  type CreateSpaceCommand,
  type Space,
  type SpaceCommand,
  type SpaceSummary,
} from './space'
import { sameSpaceValue } from './space-sync'

export type SpaceHistoryEntry = {
  revision: number
  name: string
  commandType:
    | SpaceCommand['type']
    | 'importCanvas'
    | 'importWorkspace'
    | 'resourceMove'
    | 'resourceDelete'
  createdAt: number
  deletedAt?: number
}

export type SpaceImportRecord = {
  sourceKind: 'canvas' | 'workspace'
  sourceKey: string
  sourceDigest: string
  spaceId?: string
  status: 'imported' | 'updated' | 'unchanged' | 'quarantined'
  error?: string
  importedAt: number
  raw: unknown
}

export type ApplySpaceCommandRequest = {
  commandId?: string
  spaceId?: string
  expectedRevision?: number
  command: SpaceCommand
}

export type WorkspaceSpaceImport = {
  sourceKey: string
  raw: unknown
  id: string
  name: string
  panes: Space['panes']
  arrangements: Space['arrangements']
}

export type SpaceConflict = {
  expectedRevision: number
  currentRevision: number
  current: Space
}

export type SpaceHistoryExpired = { oldestRetainedRevision: number }

export class SpaceTransportError extends Error {
  constructor(
    public code: 'offline' | 'conflict' | 'historyExpired' | 'invalid' | 'failed',
    message: string,
    public conflict?: SpaceConflict,
    public historyExpired?: SpaceHistoryExpired,
  ) {
    super(message)
  }
}

export interface SpaceTransport {
  list(signal?: AbortSignal): Promise<SpaceSummary[]>
  load(spaceId: string, signal?: AbortSignal): Promise<Space>
  history(spaceId: string, signal?: AbortSignal): Promise<SpaceHistoryEntry[]>
  loadRevision(spaceId: string, revision: number, signal?: AbortSignal): Promise<Space>
  listImports(signal?: AbortSignal): Promise<SpaceImportRecord[]>
  importCanvases(
    canvases: unknown[],
    signal?: AbortSignal,
  ): Promise<{ spaces: Space[]; imports: SpaceImportRecord[] }>
  importWorkspace(
    workspace: WorkspaceSpaceImport,
    signal?: AbortSignal,
  ): Promise<{ space: Space; import: SpaceImportRecord }>
  apply(request: ApplySpaceCommandRequest, signal?: AbortSignal): Promise<Space>
}

function encoded(value: string) {
  return `~${encodeURIComponent(value)}`
}

function parseHistoryEntry(value: unknown): SpaceHistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SpaceHistoryEntry>
  if (
    !Number.isSafeInteger(raw.revision) ||
    Number(raw.revision) < 0 ||
    typeof raw.name !== 'string' ||
    !raw.name.trim() ||
    ![
      'create',
      'rename',
      'delete',
      'duplicate',
      'addPane',
      'removePane',
      'updatePane',
      'applyArrangement',
      'restoreRevision',
      'importCanvas',
      'importWorkspace',
      'resourceMove',
      'resourceDelete',
    ].includes(raw.commandType ?? '') ||
    !Number.isSafeInteger(raw.createdAt) ||
    Number(raw.createdAt) < 0 ||
    (raw.deletedAt !== undefined &&
      (!Number.isSafeInteger(raw.deletedAt) || Number(raw.deletedAt) < 0))
  ) {
    return null
  }
  return structuredClone(raw) as SpaceHistoryEntry
}

function parseImportRecord(value: unknown): SpaceImportRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SpaceImportRecord>
  if (
    (raw.sourceKind !== 'canvas' && raw.sourceKind !== 'workspace') ||
    typeof raw.sourceKey !== 'string' ||
    !raw.sourceKey ||
    typeof raw.sourceDigest !== 'string' ||
    !raw.sourceDigest ||
    (raw.spaceId !== undefined && (typeof raw.spaceId !== 'string' || !raw.spaceId)) ||
    (raw.status !== 'imported' &&
      raw.status !== 'updated' &&
      raw.status !== 'unchanged' &&
      raw.status !== 'quarantined') ||
    !Number.isSafeInteger(raw.importedAt) ||
    Number(raw.importedAt) < 0 ||
    (raw.error !== undefined && typeof raw.error !== 'string')
  ) {
    return null
  }
  return structuredClone(raw) as SpaceImportRecord
}

function normalizeTransportError(error: unknown): SpaceTransportError {
  if (error instanceof SpaceTransportError) return error
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new SpaceTransportError('offline', 'Space changes are waiting for a connection')
  }
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return new SpaceTransportError('invalid', error.message)
  }
  return new SpaceTransportError(
    'failed',
    error instanceof Error ? error.message : 'Space request failed',
  )
}

async function requestSpace(url: string, options?: RequestInit): Promise<Space> {
  try {
    const response = await fetch(url, options)
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (
      response.status === 410 &&
      body.error === 'space_history_expired' &&
      Number.isSafeInteger(body.oldestRetainedRevision)
    ) {
      throw new SpaceTransportError(
        'historyExpired',
        typeof body.message === 'string' ? body.message : 'Space revision is no longer retained',
        undefined,
        { oldestRetainedRevision: Number(body.oldestRetainedRevision) },
      )
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        typeof body.error === 'string' ? body.error : response.statusText,
      )
    }
    return parseSpaceOrThrow(body.space)
  } catch (error) {
    throw normalizeTransportError(error)
  }
}

export function createBrowserSpaceTransport(): SpaceTransport {
  return {
    async list(signal) {
      try {
        const result = await api<{ spaces: unknown[] }>('/api/spaces', { signal })
        if (!Array.isArray(result.spaces)) throw new Error('Invalid Space list')
        const spaces = result.spaces.map(parseSpaceSummary)
        if (spaces.some((space) => !space)) throw new Error('Invalid Space summary')
        return spaces as SpaceSummary[]
      } catch (error) {
        throw normalizeTransportError(error)
      }
    },
    load: (spaceId, signal) => requestSpace(`/api/spaces/by-id/${encoded(spaceId)}`, { signal }),
    async history(spaceId, signal) {
      try {
        const result = await api<{ spaceId: string; history: unknown[] }>(
          `/api/spaces/by-id/${encoded(spaceId)}/history`,
          { signal },
        )
        if (!Array.isArray(result.history)) throw new Error('Invalid Space history')
        const history = result.history.map(parseHistoryEntry)
        if (history.some((entry) => !entry)) throw new Error('Invalid Space history entry')
        return history as SpaceHistoryEntry[]
      } catch (error) {
        throw normalizeTransportError(error)
      }
    },
    loadRevision: (spaceId, revision, signal) =>
      requestSpace(`/api/spaces/by-id/${encoded(spaceId)}/revisions/${revision}`, { signal }),
    async listImports(signal) {
      try {
        const result = await api<{ imports: unknown[] }>('/api/spaces/import-export', { signal })
        if (!Array.isArray(result.imports)) throw new Error('Invalid Space import list')
        const imports = result.imports.map(parseImportRecord)
        if (imports.some((entry) => !entry)) throw new Error('Invalid Space import record')
        return imports as SpaceImportRecord[]
      } catch (error) {
        throw normalizeTransportError(error)
      }
    },
    async importCanvases(canvases, signal) {
      try {
        const result = await api<{ spaces: unknown[]; imports: unknown[] }>(
          '/api/spaces/import/canvases',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ canvases }),
            signal,
          },
        )
        if (!Array.isArray(result.spaces) || !Array.isArray(result.imports)) {
          throw new Error('Invalid Canvas import result')
        }
        const imports = result.imports.map(parseImportRecord)
        if (imports.some((entry) => !entry)) throw new Error('Invalid Space import record')
        return {
          spaces: result.spaces.map(parseSpaceOrThrow),
          imports: imports as SpaceImportRecord[],
        }
      } catch (error) {
        throw normalizeTransportError(error)
      }
    },
    async importWorkspace(workspace, signal) {
      try {
        const result = await api<{ space: unknown; import: unknown }>(
          '/api/spaces/import/workspaces',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(workspace),
            signal,
          },
        )
        const imported = parseImportRecord(result.import)
        if (!imported) throw new Error('Invalid Workspace import record')
        return { space: parseSpaceOrThrow(result.space), import: imported }
      } catch (error) {
        throw normalizeTransportError(error)
      }
    },
    async apply(request, signal) {
      let response: Response
      try {
        response = await fetch('/api/spaces/commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          keepalive: true,
          signal,
        })
      } catch (error) {
        throw normalizeTransportError(error)
      }
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (response.status === 409 && body.error === 'space_revision_conflict') {
        const parsedCurrent = parseSpace(body.current)
        if (
          parsedCurrent.ok &&
          Number.isSafeInteger(body.expectedRevision) &&
          Number.isSafeInteger(body.currentRevision)
        ) {
          throw new SpaceTransportError('conflict', 'Space changed on another device', {
            expectedRevision: body.expectedRevision as number,
            currentRevision: body.currentRevision as number,
            current: parsedCurrent.space,
          })
        }
      }
      if (!response.ok) {
        throw normalizeTransportError(
          new ApiError(
            response.status,
            typeof body.error === 'string' ? body.error : response.statusText,
          ),
        )
      }
      return parseSpaceOrThrow(body.space)
    },
  }
}

export type SpaceSaveStatus = 'saved' | 'saving' | 'offline' | 'conflict' | 'failed'

export type OptimisticSpaceSnapshot = {
  space: Space | null
  status: SpaceSaveStatus
  pending: number
  error: string | null
  recoveredCopy: Space | null
}

export interface OptimisticSpaceClient {
  getSnapshot(): OptimisticSpaceSnapshot
  subscribe(listener: () => void): () => void
  subscribeCommands(
    listener: (event: { command: SpaceCommand; beforeRevision: number }) => void,
  ): () => void
  getPendingCommands(): PendingSpaceCommand[]
  load(spaceId: string): Promise<Space>
  dispatch(command: SpaceCommand, options?: { commandId?: string }): Promise<Space>
  waitForIdle(): Promise<void>
  retry(): Promise<void>
  setOnline(online: boolean): void
  dispose(): void
}

export type OptimisticSpaceClientOptions = {
  transport: SpaceTransport
  initialSpace?: Space | null
  online?: () => boolean
  id?: () => string
  commandId?: () => string
  now?: () => number
  recoveredName?: (space: Space) => string
}

type QueuedCommand = {
  commandId: string
  command: SpaceCommand
  resolve: (space: Space) => void
  reject: (error: unknown) => void
}

export type PendingSpaceCommand = Readonly<{
  commandId: string
  command: SpaceCommand
}>

function defaultId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function cloneSnapshot(snapshot: OptimisticSpaceSnapshot): OptimisticSpaceSnapshot {
  return {
    ...snapshot,
    space: snapshot.space ? structuredClone(snapshot.space) : null,
    recoveredCopy: snapshot.recoveredCopy ? structuredClone(snapshot.recoveredCopy) : null,
  }
}

function optimisticApply(space: Space | null, command: SpaceCommand, now: () => number): Space {
  if (command.type === 'restoreRevision') {
    if (!space) throw new SpaceTransportError('invalid', 'Space does not exist')
    return structuredClone(space)
  }
  if (command.type === 'create' && !command.id) {
    throw new SpaceTransportError('invalid', 'Optimistic create requires an ID')
  }
  if (command.type === 'duplicate' && !command.newId) {
    throw new SpaceTransportError('invalid', 'Optimistic duplicate requires a newId')
  }
  if (
    command.type === 'duplicate' &&
    command.sourceRevision !== undefined &&
    space &&
    command.sourceRevision !== space.revision
  ) {
    return structuredClone(space)
  }
  const result = reduceSpaceCommand(space, command, { now })
  if (!result.ok) throw new SpaceTransportError('invalid', result.message)
  return result.space
}

export function isSpaceCommandSatisfied(space: Space, command: SpaceCommand): boolean {
  switch (command.type) {
    case 'create':
      return (
        space.id === command.id &&
        space.name === command.name.trim() &&
        space.origin === command.origin &&
        sameSpaceValue(space.panes, command.panes ?? {}) &&
        sameSpaceValue(space.arrangements, command.arrangements ?? {})
      )
    case 'rename':
      return space.name === command.name.trim()
    case 'delete':
      return space.deletedAt !== undefined
    case 'addPane':
    case 'updatePane':
      return sameSpaceValue(space.panes[command.paneId], command.pane)
    case 'removePane':
      return !Object.hasOwn(space.panes, command.paneId)
    case 'applyArrangement':
      return sameSpaceValue(
        space.arrangements[command.presentation],
        command.arrangement ?? undefined,
      )
    case 'duplicate':
    case 'restoreRevision':
      return false
  }
}

function makeRecoveredCopy(
  desired: Space,
  id: () => string,
  now: () => number,
  recoveredName: (space: Space) => string,
): Space {
  const timestamp = Math.max(0, Math.floor(now()))
  const requestedName = recoveredName(desired).trim()
  const name = requestedName.length > 120 ? requestedName.slice(0, 120).trimEnd() : requestedName
  return parseSpaceOrThrow({
    ...structuredClone(desired),
    id: id(),
    name,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: undefined,
  })
}

export function createOptimisticSpaceClient(
  options: OptimisticSpaceClientOptions,
): OptimisticSpaceClient {
  const online =
    options.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const now = options.now ?? Date.now
  const id = options.id ?? defaultId
  const commandId = options.commandId ?? (() => `space-command-${defaultId()}`)
  const recoveredName =
    options.recoveredName ??
    ((space: Space) => {
      const suffix = ' (recovered)'
      return `${space.name.slice(0, 120 - suffix.length).trimEnd()}${suffix}`
    })
  const listeners = new Set<() => void>()
  const commandListeners = new Set<
    (event: { command: SpaceCommand; beforeRevision: number }) => void
  >()
  const idleWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>()
  const queue: QueuedCommand[] = []
  let disposed = false
  let running = false
  let generation = 0
  let pendingRecovery: { recovered: Space; failure: SpaceTransportError } | null = null
  let confirmed = options.initialSpace ? parseSpaceOrThrow(options.initialSpace) : null
  let snapshot: OptimisticSpaceSnapshot = {
    space: confirmed ? structuredClone(confirmed) : null,
    status: 'saved',
    pending: 0,
    error: null,
    recoveredCopy: null,
  }

  function emit(patch: Partial<OptimisticSpaceSnapshot>) {
    snapshot = Object.freeze({ ...snapshot, ...patch })
    for (const listener of [...listeners]) listener()
    if (snapshot.pending === 0 && (snapshot.status === 'saved' || snapshot.status === 'conflict')) {
      for (const waiter of idleWaiters) waiter.resolve()
      idleWaiters.clear()
    } else if (snapshot.status === 'offline' || snapshot.status === 'failed') {
      const error = new SpaceTransportError(
        snapshot.status,
        snapshot.error ?? 'Space still has unsaved changes',
      )
      for (const waiter of idleWaiters) waiter.reject(error)
      idleWaiters.clear()
    }
  }

  function replay(base: Space | null, commands = queue): Space | null {
    return commands.reduce<Space | null>(
      (current, item) => optimisticApply(current, item.command, now),
      base ? structuredClone(base) : null,
    )
  }

  function requestFor(entry: QueuedCommand): ApplySpaceCommandRequest {
    if (entry.command.type === 'create') {
      return { commandId: entry.commandId, command: entry.command }
    }
    return {
      commandId: entry.commandId,
      spaceId: confirmed?.id ?? snapshot.space?.id,
      expectedRevision: confirmed?.revision ?? 0,
      command: entry.command,
    }
  }

  async function recoverDesiredCopy(
    desired: Space,
    failure: SpaceTransportError,
  ): Promise<Space | null> {
    let recovered: Space
    try {
      recovered = makeRecoveredCopy(desired, id, now, recoveredName)
    } catch (error) {
      emit({
        recoveredCopy: null,
        status: 'failed',
        pending: queue.length,
        error: error instanceof Error ? error.message : failure.message,
      })
      return null
    }
    const create: CreateSpaceCommand = {
      type: 'create',
      id: recovered.id,
      name: recovered.name,
      origin: recovered.origin,
      panes: recovered.panes,
      arrangements: recovered.arrangements,
    }
    pendingRecovery = { recovered, failure }
    try {
      const saved = await options.transport.apply({ command: create })
      pendingRecovery = null
      emit({
        recoveredCopy: saved,
        status: 'conflict',
        pending: queue.length,
        error: failure.message,
      })
      return saved
    } catch (rawError) {
      const saveFailure = normalizeTransportError(rawError)
      emit({
        recoveredCopy: null,
        status: saveFailure.code === 'offline' ? 'offline' : 'failed',
        pending: queue.length,
        error: `${failure.message}. Recovered copy could not be saved: ${saveFailure.message}`,
      })
      return null
    }
  }

  async function retryRecovery() {
    const pending = pendingRecovery
    if (!pending || disposed) return
    if (!online()) {
      emit({ status: 'offline', recoveredCopy: null })
      return
    }
    const create: CreateSpaceCommand = {
      type: 'create',
      id: pending.recovered.id,
      name: pending.recovered.name,
      origin: pending.recovered.origin,
      panes: pending.recovered.panes,
      arrangements: pending.recovered.arrangements,
    }
    emit({ status: 'saving', error: null, recoveredCopy: null })
    try {
      let saved: Space | null = null
      try {
        const existing = await options.transport.load(pending.recovered.id)
        if (existing.id === pending.recovered.id) saved = existing
      } catch {}
      saved ??= await options.transport.apply({ command: create })
      if (disposed || pendingRecovery !== pending) return
      pendingRecovery = null
      emit({
        recoveredCopy: saved,
        status: 'conflict',
        pending: queue.length,
        error: pending.failure.message,
      })
    } catch (rawError) {
      if (disposed || pendingRecovery !== pending) return
      const error = normalizeTransportError(rawError)
      emit({
        recoveredCopy: null,
        status: error.code === 'offline' ? 'offline' : 'failed',
        error: `${pending.failure.message}. Recovered copy could not be saved: ${error.message}`,
      })
    }
  }

  async function drain() {
    if (running || disposed || queue.length === 0) return
    if (!online()) {
      emit({ status: 'offline', pending: queue.length })
      return
    }
    running = true
    const runGeneration = generation
    emit({ status: 'saving', pending: queue.length, error: null })
    try {
      while (queue.length > 0 && !disposed) {
        const entry = queue[0]!
        const desired = snapshot.space ? structuredClone(snapshot.space) : null
        let appliedOverRevision = confirmed?.revision ?? 0
        let acceptedByClient = false
        try {
          const saved = await options.transport.apply(requestFor(entry))
          if (runGeneration !== generation || disposed) return
          confirmed = saved
          acceptedByClient = true
        } catch (rawError) {
          if (runGeneration !== generation || disposed) return
          const error = normalizeTransportError(rawError)
          if (error.code === 'offline') {
            emit({ status: 'offline', pending: queue.length, error: error.message })
            return
          }
          if (error.code === 'conflict' && error.conflict) {
            confirmed = error.conflict.current
            if (isSpaceCommandSatisfied(confirmed, entry.command)) {
              acceptedByClient = false
            } else {
              appliedOverRevision = confirmed.revision
              let rebased: Space | null
              let replayed: Space | null
              try {
                rebased = optimisticApply(confirmed, entry.command, now)
                replayed = replay(confirmed)
              } catch {
                rebased = null
                replayed = null
              }
              if (rebased && replayed) {
                emit({
                  space: replayed,
                  status: 'saving',
                  pending: queue.length,
                  error: null,
                })
                try {
                  const saved = await options.transport.apply(requestFor(entry))
                  if (runGeneration !== generation || disposed) return
                  confirmed = saved
                  acceptedByClient = true
                } catch (retryError) {
                  const retryFailure = normalizeTransportError(retryError)
                  if (retryFailure.code === 'offline' || retryFailure.code === 'failed') {
                    emit({
                      status: retryFailure.code === 'offline' ? 'offline' : 'failed',
                      pending: queue.length,
                      error: retryFailure.message,
                    })
                    return
                  }
                  const remaining = queue.splice(0)
                  await recoverDesiredCopy(desired ?? rebased, retryFailure)
                  for (const pending of remaining) pending.reject(retryFailure)
                  return
                }
              } else {
                const remaining = queue.splice(0)
                await recoverDesiredCopy(desired ?? error.conflict.current, error)
                for (const pending of remaining) pending.reject(error)
                return
              }
            }
          } else {
            emit({ status: 'failed', pending: queue.length, error: error.message })
            return
          }
        }
        queue.shift()
        if (acceptedByClient) {
          for (const listener of [...commandListeners]) {
            listener({
              command: structuredClone(entry.command),
              beforeRevision: appliedOverRevision,
            })
          }
        }
        entry.resolve(structuredClone(confirmed))
        let optimistic: Space | null
        try {
          optimistic = replay(confirmed)
        } catch (error) {
          const failure = normalizeTransportError(error)
          const remaining = queue.splice(0)
          await recoverDesiredCopy(desired ?? confirmed, failure)
          for (const pending of remaining) pending.reject(failure)
          return
        }
        emit({
          space: optimistic,
          pending: queue.length,
          status: queue.length > 0 ? 'saving' : 'saved',
          error: null,
        })
      }
    } finally {
      running = false
    }
  }

  return {
    getSnapshot: () => cloneSnapshot(snapshot),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeCommands(listener) {
      commandListeners.add(listener)
      return () => commandListeners.delete(listener)
    },
    getPendingCommands() {
      return queue.map((entry) => ({
        commandId: entry.commandId,
        command: structuredClone(entry.command),
      }))
    },
    async load(spaceId) {
      if (disposed) throw new SpaceTransportError('failed', 'Client is disposed')
      const loadGeneration = ++generation
      running = false
      const space = await options.transport.load(spaceId)
      if (loadGeneration !== generation || disposed) return structuredClone(space)
      const replaced = queue.splice(0)
      pendingRecovery = null
      const error = new SpaceTransportError('failed', 'Pending changes were replaced by a load')
      for (const entry of replaced) entry.reject(error)
      confirmed = space
      emit({ space, status: 'saved', pending: 0, error: null, recoveredCopy: null })
      return structuredClone(space)
    },
    dispatch(command, dispatchOptions) {
      if (disposed) return Promise.reject(new SpaceTransportError('failed', 'Client is disposed'))
      let optimistic: Space
      try {
        optimistic = optimisticApply(snapshot.space, command, now)
      } catch (error) {
        return Promise.reject(error)
      }
      const promise = new Promise<Space>((resolve, reject) =>
        queue.push({
          commandId: dispatchOptions?.commandId ?? commandId(),
          command,
          resolve,
          reject,
        }),
      )
      emit({
        space: optimistic,
        pending: queue.length,
        status: online() ? 'saving' : 'offline',
        error: null,
      })
      void drain()
      return promise
    },
    waitForIdle() {
      if (disposed) return Promise.reject(new SpaceTransportError('failed', 'Client is disposed'))
      if (
        snapshot.pending === 0 &&
        (snapshot.status === 'saved' || snapshot.status === 'conflict')
      ) {
        return Promise.resolve()
      }
      if (snapshot.status === 'offline' || snapshot.status === 'failed') {
        return Promise.reject(
          new SpaceTransportError(
            snapshot.status,
            snapshot.error ?? 'Space still has unsaved changes',
          ),
        )
      }
      return new Promise<void>((resolve, reject) => idleWaiters.add({ resolve, reject }))
    },
    async retry() {
      if (snapshot.status === 'failed')
        emit({ status: online() ? 'saving' : 'offline', error: null })
      if (pendingRecovery) {
        await retryRecovery()
        return
      }
      await drain()
    },
    setOnline(isOnline) {
      if (!isOnline) {
        if (queue.length > 0 || pendingRecovery) emit({ status: 'offline', pending: queue.length })
        return
      }
      if (pendingRecovery) {
        void retryRecovery()
        return
      }
      if (queue.length > 0) {
        emit({ status: 'saving', pending: queue.length, error: null })
        void drain()
      }
    },
    dispose() {
      disposed = true
      generation += 1
      const error = new SpaceTransportError('failed', 'Client is disposed')
      for (const entry of queue.splice(0)) entry.reject(error)
      for (const waiter of idleWaiters) waiter.reject(error)
      idleWaiters.clear()
      listeners.clear()
      commandListeners.clear()
    },
  }
}
