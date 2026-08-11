export type PhysicalOfflinePathRun = Readonly<{
  completion: Promise<void>
  cancel(): void
  isCurrent(): boolean
}>

export type PhysicalOfflinePathCoordinator = Readonly<{
  schedule(path: string, operation: (signal: AbortSignal) => Promise<void>): PhysicalOfflinePathRun
}>

function physicalPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    !left ||
    !right ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  )
}

export function createPhysicalOfflinePathCoordinator(): PhysicalOfflinePathCoordinator {
  type ActivePathRun = {
    key: string
    controller: AbortController
    completion: Promise<void>
    current: boolean
  }

  const active = new Set<ActivePathRun>()

  return {
    schedule(path, operation) {
      const key = physicalPath(path)
      const previous = [...active].filter((state) => pathsOverlap(key, state.key))
      for (const state of previous) {
        state.current = false
        state.controller.abort()
      }

      const controller = new AbortController()
      const waitForPrevious = Promise.all(
        previous.map((state) => state.completion.catch(() => undefined)),
      )
      const completion = waitForPrevious.then(() => operation(controller.signal))
      const state: ActivePathRun = { key, controller, completion, current: true }
      const run: PhysicalOfflinePathRun = {
        completion,
        cancel: () => controller.abort(),
        isCurrent: () => state.current && active.has(state),
      }
      active.add(state)

      const release = () => active.delete(state)
      void completion.then(release, release)
      return run
    },
  }
}
