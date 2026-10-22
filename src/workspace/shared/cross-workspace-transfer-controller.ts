import { randomId } from '@/lib/random-id'
import { createWorkspaceTransferMachine } from '@/workspace/model/workspace-transfer'
import { workspaceValueEquals } from '@/workspace/model/workspace-equality'
import type { PersistedWorkspaceState } from '@/workspace/model/workspace'
import type { WorkspaceSessionTransferInput } from './workspace-registry'
import { Deferred, Effect } from 'effect'
import { modelOwner } from 'effectweb'
type Accessor<T> = () => T
export type WorkspaceTransferSession = {
  state: { editable: Accessor<boolean> }
  document: {
    value: Accessor<PersistedWorkspaceState | null>
    update(
      value:
        | PersistedWorkspaceState
        | null
        | ((current: PersistedWorkspaceState | null) => PersistedWorkspaceState | null),
    ): PersistedWorkspaceState | null
  }
  transfer: {
    windows(
      input: WorkspaceSessionTransferInput,
    ): Effect.Effect<
      | { kind: 'moved'; destinationId: string }
      | { kind: 'failed'; rollback: boolean; message: string },
      unknown
    >
  }
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
  onError?: (message: string) => void
  onSettled?: () => void
}
type TransferStart = {
  sourceId: string
  sourceDocument: PersistedWorkspaceState
  windowIds: string[]
}
/** Owns cross-workspace dwell, cancellation, and the two-document move transaction. */
export function createCrossWorkspaceTransferController(
  options: CrossWorkspaceTransferControllerOptions,
) {
  const machine = createWorkspaceTransferMachine()
  const owner = modelOwner({ machineState: machine.getState(), committing: false })
  const machineState = () => owner.read().machineState
  const committing = () => owner.read().committing
  const setMachineState = (machineState: ReturnType<typeof machine.getState>) =>
    owner.patch({ machineState })
  const setCommitting = (committing: boolean) => owner.patch({ committing })
  let start: TransferStart | null = null
  const hoverSlot = 'workspace-transfer-hover'
  let completion: Deferred.Deferred<boolean> | null = null
  const commitSlot = 'workspace-transfer-commit'
  const publishMachine = () => setMachineState(machine.getState())
  const clearHoverTimer = () => owner.cancel(hoverSlot)

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
    const sourceDocument = options.session.document.value()
    if (!sourceId || !sourceDocument || !options.session.state.editable()) return false
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
    owner.run(
      hoverSlot,
      Effect.sleep(options.dwellMs ?? 1000).pipe(
        Effect.andThen(
          Effect.sync(() => {
            machine.arm(target, generation)
            publishMachine()
          }),
        ),
      ),
      'replace',
    )
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
    const latest = options.session.document.value()
    if (rollback && latest && options.sourceId() === rollback.sourceId) {
      const next = options.rollbackGesture(latest, rollback.sourceDocument, rollback.windowIds)
      if (!workspaceValueEquals(latest, next)) options.session.document.update(() => next)
    }
    reset()
    options.onSettled?.()
    return !!rollback
  }
  const performCommit = (
    transfer: NonNullable<ReturnType<typeof machine.end>['commit']>,
    started: TransferStart,
  ) =>
    Effect.gen(function* () {
      const destinationWasCreated = transfer.destinationId === '__new__'
      const destinationId = destinationWasCreated
        ? (options.createId?.() ?? randomId())
        : transfer.destinationId
      return yield* Effect.gen(function* () {
        const result = yield* options.session.transfer.windows({
          sourceId: started.sourceId,
          destinationId,
          destinationFallback: options.emptyDestination(),
          windowIds: transfer.windowIds,
          viewport: options.viewport(),
        })
        if (result.kind === 'failed') {
          if (result.rollback) {
            const latest = options.session.document.value()
            if (latest && options.sourceId() === started.sourceId) {
              const next = options.rollbackGesture(
                latest,
                started.sourceDocument,
                started.windowIds,
              )
              if (!workspaceValueEquals(latest, next)) options.session.document.update(() => next)
            }
            options.navigate(started.sourceId)
          }
          options.onError?.(result.message)
          return false
        }
        options.navigate(destinationId)
        return true
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            options.onError?.(
              error instanceof Error ? error.message : 'Could not move windows to workspace.',
            )
            return false
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setCommitting(false)
            reset()
            options.onSettled?.()
          }),
        ),
      )
    })
  const drop = (destinationTarget?: string | null): Effect.Effect<boolean> =>
    Effect.suspend(() => {
      if (completion) return Deferred.await(completion)
      if (!start) return Effect.succeed(false)
      clearHoverTimer()
      const ended = machine.end(destinationTarget ?? null)
      const started = start
      if (!ended.commit) {
        setMachineState(ended.state)
        start = null
        options.onSettled?.()
        return Effect.succeed(false)
      }
      setCommitting(true)
      setMachineState(ended.state)
      const done = Deferred.makeUnsafe<boolean>()
      completion = done
      owner.run(
        commitSlot,
        performCommit(ended.commit, started).pipe(
          Effect.match({ onFailure: () => false, onSuccess: (value) => value }),
          Effect.flatMap((value) => Deferred.succeed(done, value)),
          Effect.ensuring(
            Effect.sync(() => {
              if (completion === done) completion = null
            }),
          ),
        ),
        'drop',
      )
      return Deferred.await(done)
    })
  const settleBeforeNavigation = () =>
    Effect.suspend(() =>
      completion
        ? Deferred.await(completion).pipe(Effect.asVoid)
        : Effect.sync(() => {
            if (start) cancel()
          }),
    )
  const dispose = () => {
    owner.dispose()
    clearHoverTimer()
    start = null
  }
  return {
    source: owner.source,
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
    close: () =>
      Effect.sync(clearHoverTimer).pipe(
        Effect.andThen(settleBeforeNavigation()),
        Effect.andThen(owner.close()),
      ),
    dispose,
  }
}
