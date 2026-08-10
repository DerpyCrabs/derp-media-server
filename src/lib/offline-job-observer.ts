export const OFFLINE_JOB_EVENT = 'derp-offline-status'

export type OfflineJobScope = 'owner' | `share:${string}`

export type OfflineJob = {
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'removed'
  scope: OfflineJobScope
  name?: string
  path?: string
  completed?: number
  downloadedBytes?: number
  totalBytes?: number
  errorKind?: 'quota' | 'network' | 'auth' | 'unsupported-format' | 'cancelled'
  message?: string
}

export type OfflineJobUpdate = Omit<OfflineJob, 'scope'> & {
  scope?: OfflineJobScope
}

export type OfflineJobObserver = {
  getSnapshot(scope: OfflineJobScope): readonly OfflineJob[]
  subscribe(scope: OfflineJobScope, listener: (snapshot: readonly OfflineJob[]) => void): () => void
}

const STATES = new Set<OfflineJob['state']>([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'removed',
])
const MAX_JOBS_PER_SCOPE = 20

function normalizeScope(scope: unknown): OfflineJobScope {
  if (scope === 'owner') return scope
  if (typeof scope === 'string' && scope.startsWith('share:') && scope.length > 6) {
    return scope as OfflineJobScope
  }
  return 'owner'
}

function parseUpdate(value: unknown): OfflineJob | null {
  if (!value || typeof value !== 'object') return null
  const update = value as Partial<OfflineJob>
  if (!update.state || !STATES.has(update.state)) return null
  return {
    ...update,
    state: update.state,
    scope: normalizeScope(update.scope),
  }
}

function jobKey(job: OfflineJob): string {
  return job.path ?? job.name ?? 'unknown'
}

export function shareOfflineJobScope(token: string): OfflineJobScope {
  return `share:${token}`
}

export function createOfflineJobObserver(events: EventTarget | null): OfflineJobObserver {
  const snapshots = new Map<OfflineJobScope, readonly OfflineJob[]>()
  const listeners = new Map<OfflineJobScope, Set<(snapshot: readonly OfflineJob[]) => void>>()

  function accept(value: unknown) {
    const update = parseUpdate(value)
    if (!update) return
    const current = snapshots.get(update.scope) ?? []
    const key = jobKey(update)
    const previous = current.find((job) => jobKey(job) === key)
    const next = Object.freeze({
      ...(update.state === 'queued' ? undefined : previous),
      ...update,
    })
    const snapshot = Object.freeze(
      [next, ...current.filter((job) => jobKey(job) !== key)].slice(0, MAX_JOBS_PER_SCOPE),
    )
    snapshots.set(update.scope, snapshot)
    for (const listener of listeners.get(update.scope) ?? []) listener(snapshot)
  }

  events?.addEventListener(OFFLINE_JOB_EVENT, (event) => {
    accept((event as CustomEvent<unknown>).detail)
  })

  return {
    getSnapshot(scope) {
      return snapshots.get(scope) ?? []
    },
    subscribe(scope, listener) {
      let scoped = listeners.get(scope)
      if (!scoped) {
        scoped = new Set()
        listeners.set(scope, scoped)
      }
      scoped.add(listener)
      listener(snapshots.get(scope) ?? [])
      return () => {
        scoped?.delete(listener)
        if (scoped?.size === 0) listeners.delete(scope)
      }
    },
  }
}

const browserEvents = typeof window === 'undefined' ? null : window

export const offlineJobObserver = createOfflineJobObserver(browserEvents)

export function publishOfflineJob(update: OfflineJobUpdate): void {
  if (!browserEvents) return
  browserEvents.dispatchEvent(new CustomEvent(OFFLINE_JOB_EVENT, { detail: update }))
}
