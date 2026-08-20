export type PendingWorkspaceSave<T> = {
  id: string
  state: T
  revision: number
}

export type WorkspaceSaveResult = {
  revision?: number
}

export type WorkspaceSaveCoordinator<T> = {
  enqueue: (pending: PendingWorkspaceSave<T>) => void
  flush: (pendingOrId: PendingWorkspaceSave<T> | string) => Promise<void>
  retry: (id: string) => Promise<void>
  pending: (id: string) => PendingWorkspaceSave<T> | null
  clear: (id: string) => void
}

export type WorkspaceOperationCoordinator = {
  run: <T>(ids: string | readonly string[], operation: () => Promise<T>) => Promise<T>
}

export function createWorkspaceOperationCoordinator(): WorkspaceOperationCoordinator {
  const tails = new Map<string, Promise<void>>()

  function run<T>(ids: string | readonly string[], operation: () => Promise<T>): Promise<T> {
    const keys = [...new Set(typeof ids === 'string' ? [ids] : ids)].filter(Boolean).sort()
    const previous = keys.map((id) => tails.get(id)?.catch(() => undefined) ?? Promise.resolve())
    const result = Promise.all(previous).then(operation)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    for (const id of keys) tails.set(id, tail)
    void tail.then(() => {
      for (const id of keys) {
        if (tails.get(id) === tail) tails.delete(id)
      }
    })
    return result
  }

  return { run }
}

function createQueue<T>() {
  return {
    pending: null as PendingWorkspaceSave<T> | null,
    active: null as PendingWorkspaceSave<T> | null,
    inFlight: null as Promise<void> | null,
    error: null as unknown,
  }
}

/**
 * Starts saves immediately and coalesces newer state behind each in-flight request.
 *
 * A save started for one id never replaces pending work for another id. If a
 * newer state arrives while a request is in flight, flush waits for it too.
 */
export function createWorkspaceSaveCoordinator<T>(options: {
  save: (pending: PendingWorkspaceSave<T>) => Promise<WorkspaceSaveResult>
}): WorkspaceSaveCoordinator<T> {
  const queues = new Map<string, ReturnType<typeof createQueue<T>>>()

  function queueFor(id: string) {
    let queue = queues.get(id)
    if (!queue) {
      queue = createQueue<T>()
      queues.set(id, queue)
    }
    return queue
  }

  function start(id: string) {
    const queue = queues.get(id)
    if (!queue || queue.inFlight || queue.error || !queue.pending) return
    const pending = queue.pending
    queue.pending = null
    queue.active = pending
    const run = (async () => {
      const result = await options.save(pending)
      if (result.revision == null) return
      const next = queue.pending
      if (next) queue.pending = { ...next, revision: result.revision }
    })()
    queue.inFlight = run
    void run.then(
      () => finish(id, queue!, run),
      (error) => {
        if (!queue!.pending) queue!.pending = pending
        queue!.error = error
        finish(id, queue!, run)
      },
    )
  }

  function finish(id: string, queue: ReturnType<typeof createQueue<T>>, run: Promise<void>) {
    if (queue.inFlight !== run) return
    queue.inFlight = null
    queue.active = null
    if (queue.error) return
    if (queue.pending) {
      start(id)
      return
    }
    queues.delete(id)
  }

  function enqueue(pending: PendingWorkspaceSave<T>) {
    const queue = queueFor(pending.id)
    queue.pending = pending
    start(pending.id)
  }

  async function waitForIdle(id: string) {
    while (true) {
      const queue = queues.get(id)
      if (!queue) return
      if (queue.error) throw queue.error
      if (queue.inFlight) {
        await queue.inFlight
        continue
      }
      if (queue.pending) {
        start(id)
        continue
      }
      return
    }
  }

  async function flush(pendingOrId: PendingWorkspaceSave<T> | string) {
    if (typeof pendingOrId !== 'string') {
      const queue = queueFor(pendingOrId.id)
      queue.pending = pendingOrId
      start(pendingOrId.id)
      await waitForIdle(pendingOrId.id)
      return
    }
    await waitForIdle(pendingOrId)
  }

  async function retry(id: string) {
    const queue = queues.get(id)
    if (!queue) return
    queue.error = null
    start(id)
    await waitForIdle(id)
  }

  return {
    enqueue,
    flush,
    retry,
    pending: (id) => {
      const queue = queues.get(id)
      return queue?.pending ?? queue?.active ?? null
    },
    clear: (id) => {
      const queue = queues.get(id)
      if (!queue || queue.inFlight) {
        if (queue) queue.pending = null
        return
      }
      queues.delete(id)
    },
  }
}
