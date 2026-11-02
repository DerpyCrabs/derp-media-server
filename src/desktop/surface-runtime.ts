export type SurfaceDisposer = () => Promise<void>
export type SurfaceMount = (target: Window, signal: AbortSignal) => Promise<SurfaceDisposer>

/** Owns window mounts; shared application services outlive each individual surface. */
export function createSurfaceRuntime(origin: string, mountSurface: SurfaceMount) {
  type Entry = {
    abort: AbortController
    mounted: Promise<SurfaceDisposer>
    ready: Promise<void>
    closing?: Promise<void>
  }
  const windows = new Map<Window, Entry>()
  const retired = new WeakSet<Window>()
  let closed = false
  function mount(target: Window): Promise<void> {
    if (closed || retired.has(target)) return Promise.reject(new Error('Retired app surface'))
    if (target.location.origin !== origin)
      return Promise.reject(new Error('App surface origin mismatch'))
    if (target.document.defaultView !== target)
      return Promise.reject(new Error('App surface requires its document WindowProxy'))
    const existing = windows.get(target)
    if (existing) return existing.ready
    const abort = new AbortController()
    const mounted = Promise.resolve().then(() => mountSurface(target, abort.signal))
    const ready = mounted.then(() => undefined)
    windows.set(target, { abort, mounted, ready })
    return ready
  }
  function unmount(target: Window): Promise<void> {
    retired.add(target)
    const entry = windows.get(target)
    if (!entry) return Promise.resolve()
    if (entry.closing) return entry.closing
    entry.abort.abort()
    entry.closing = entry.mounted
      .then(
        (dispose) => dispose(),
        // Failed or interrupted setup owns its rollback; no live mount was returned.
        () => undefined,
      )
      .then(() => {
        windows.delete(target)
      })
    return entry.closing
  }
  return {
    mount,
    unmount,
    async close() {
      closed = true
      await Promise.all([...windows.keys()].map(unmount))
    },
  }
}
