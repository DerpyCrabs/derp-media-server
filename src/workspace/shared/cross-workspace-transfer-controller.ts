import {
  createWorkspaceTransferMachine,
  transferWorkspaceGroups,
} from '@/workspace/model/workspace-transfer'
import { workspaceValueEquals } from '@/workspace/model/workspace-equality'
import { isApiError } from '@/lib/api/client'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import type {
  WorkspaceMoveInput,
  WorkspaceRecord,
  WorkspaceRegistry,
} from '@/workspace/model/workspace-registry'
import { createSignal, type Accessor } from 'solid-js'

export type WorkspaceTransferSession = {
  document: Accessor<PersistedWorkspaceState | null>
  editable: Accessor<boolean>
  revision: Accessor<number>
  registry: Accessor<WorkspaceRegistry>
  flush(): Promise<void>
  acquire(
    id: string,
    initial: PersistedWorkspaceState,
  ): Promise<{ editable: boolean; record: WorkspaceRecord }>
  release(id: string): Promise<void>
  deleteWorkspace(id: string): Promise<void>
  moveWorkspaces(
    input: WorkspaceMoveInput,
  ): Promise<{ sourceRevision: number; destinationRevision: number }>
  update(
    value:
      | PersistedWorkspaceState
      | null
      | ((current: PersistedWorkspaceState | null) => PersistedWorkspaceState | null),
  ): PersistedWorkspaceState | null
}

type TransferClock = {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export type CrossWorkspaceTransferControllerOptions = {
  session: WorkspaceTransferSession
  sourceId: Accessor<string>
  emptyDestination: () => PersistedWorkspaceState
  navigate: (workspaceId: string) => void
  viewport: () => { width: number; height: number }
  rollbackGesture: (
    latest: PersistedWorkspaceState,
    beforeGesture: PersistedWorkspaceState,
    windowIds: readonly string[],
  ) => PersistedWorkspaceState
  createId?: () => string
  dwellMs?: number
  clock?: TransferClock
  onError?: (message: string) => void
  onSettled?: () => void
}

type TransferStart = {
  sourceId: string
  sourceDocument: PersistedWorkspaceState
  windowIds: string[]
}

const browserClock: TransferClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Owns cross-workspace dwell, cancellation, and the two-document move transaction. */
export function createCrossWorkspaceTransferController(
  options: CrossWorkspaceTransferControllerOptions,
) {
  const machine = createWorkspaceTransferMachine()
  const clock = options.clock ?? browserClock
  const [machineState, setMachineState] = createSignal(machine.getState())
  const [committing, setCommitting] = createSignal(false)
  let start: TransferStart | null = null
  let hoverTimer: unknown
  let commitPromise: Promise<boolean> | null = null

  const publishMachine = () => setMachineState(machine.getState())

  const clearHoverTimer = () => {
    if (hoverTimer !== undefined) clock.clearTimeout(hoverTimer)
    hoverTimer = undefined
  }

  const reset = () => {
    clearHoverTimer()
    machine.cancel()
    publishMachine()
    start = null
  }

  const active = () => machineState().phase !== 'idle'
  const ready = () => machineState().phase === 'armed'
  const hoverTarget = () => machineState().hoverTargetId ?? ''

  const begin = (windowIds: readonly string[]) => {
    if (committing()) return false
    reset()
    const sourceId = options.sourceId()
    const sourceDocument = options.session.document()
    if (!sourceId || !sourceDocument || !options.session.editable()) return false
    const next = machine.begin(sourceId, windowIds)
    setMachineState(next)
    if (next.phase === 'idle') return false
    start = {
      sourceId,
      sourceDocument: structuredClone(sourceDocument),
      windowIds: [...next.windowIds],
    }
    return true
  }

  const hover = (destinationTarget: string | null) => {
    if (committing() || !start) return
    clearHoverTimer()
    const hovered = machine.hover(destinationTarget || null)
    setMachineState(hovered)
    if (!hovered.hoverTargetId) return
    const target = hovered.hoverTargetId
    const generation = hovered.generation
    hoverTimer = clock.setTimeout(() => {
      hoverTimer = undefined
      machine.arm(target, generation)
      publishMachine()
    }, options.dwellMs ?? 1_000)
  }

  const finishLocal = () => {
    if (committing()) return false
    reset()
    options.onSettled?.()
    return true
  }

  const cancel = () => {
    if (committing()) return false
    const rollback = start
    const latest = options.session.document()
    if (rollback && latest && options.sourceId() === rollback.sourceId) {
      const next = options.rollbackGesture(latest, rollback.sourceDocument, rollback.windowIds)
      if (!workspaceValueEquals(latest, next)) options.session.update(() => next)
    }
    reset()
    options.onSettled?.()
    return !!rollback
  }

  const cleanupDestination = async (destinationId: string, created: boolean) => {
    try {
      if (created) await options.session.deleteWorkspace(destinationId)
      else await options.session.release(destinationId)
    } catch {}
  }

  const performCommit = async (
    transfer: NonNullable<ReturnType<typeof machine.end>['commit']>,
    started: TransferStart,
  ) => {
    const destinationWasCreated = transfer.destinationId === '__new__'
    const destinationId = destinationWasCreated
      ? (options.createId?.() ?? crypto.randomUUID())
      : transfer.destinationId
    const destinationRecord = options.session.registry().records[destinationId]
    let destinationAcquired = false
    let moveStarted = false
    try {
      const opened = await options.session.acquire(
        destinationId,
        destinationRecord?.snapshot ?? options.emptyDestination(),
      )
      if (!opened.editable) throw new Error('Workspace is open elsewhere.')
      destinationAcquired = true

      await options.session.flush()
      const liveSource = options.session.document()
      if (!liveSource || options.sourceId() !== started.sourceId) {
        throw new Error('Workspace is no longer available.')
      }
      const moved = transferWorkspaceGroups(liveSource, opened.record.snapshot, {
        windowIds: transfer.windowIds,
        viewport: options.viewport(),
      })
      if (moved.source === liveSource) throw new Error('Windows are no longer available.')
      const sourceRecord = options.session.registry().records[started.sourceId]
      const deleteSource = !sourceRecord?.name && moved.source.windows.length === 0
      moveStarted = true
      await options.session.moveWorkspaces({
        sourceId: started.sourceId,
        destinationId,
        sourceRevision: options.session.revision(),
        destinationRevision: opened.record.revision,
        sourceSnapshot: moved.source,
        destinationSnapshot: moved.destination,
        deleteSource,
      })
      destinationAcquired = false
      options.navigate(destinationId)
      return true
    } catch (error) {
      const serverRejectedMove = moveStarted && isApiError(error)
      if (!moveStarted || serverRejectedMove) {
        if (destinationAcquired || destinationWasCreated) {
          await cleanupDestination(destinationId, destinationWasCreated)
        }
        const latest = options.session.document()
        if (latest && options.sourceId() === started.sourceId) {
          const next = options.rollbackGesture(latest, started.sourceDocument, started.windowIds)
          if (!workspaceValueEquals(latest, next)) options.session.update(() => next)
        }
        options.navigate(started.sourceId)
      }
      options.onError?.(
        error instanceof Error ? error.message : 'Could not move windows to workspace.',
      )
      return false
    } finally {
      setCommitting(false)
      reset()
      options.onSettled?.()
    }
  }

  const drop = (destinationTarget?: string | null): Promise<boolean> => {
    if (commitPromise) return commitPromise
    if (!start) return Promise.resolve(false)
    clearHoverTimer()
    const ended = machine.end(destinationTarget ?? null)
    const started = start
    if (!ended.commit) {
      setMachineState(ended.state)
      start = null
      options.onSettled?.()
      return Promise.resolve(false)
    }
    setCommitting(true)
    setMachineState(ended.state)
    const current = performCommit(ended.commit, started)
    commitPromise = current
    void current.finally(() => {
      if (commitPromise === current) commitPromise = null
    })
    return current
  }

  const settleBeforeNavigation = async () => {
    if (commitPromise) await commitPromise
    else if (start) cancel()
  }

  return {
    active,
    ready,
    committing,
    hoverTarget,
    begin,
    hover,
    drop,
    settleBeforeNavigation,
    cancel,
    finishLocal,
    dispose: finishLocal,
  }
}
