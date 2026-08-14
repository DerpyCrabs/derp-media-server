import type { AppSurface } from '@/src/lib/routes'

export type SurfaceLifecycleHandler = Readonly<{
  leave(): Promise<boolean>
  beforeUnload?(event: BeforeUnloadEvent): void
}>

export type SurfaceLifecycleCoordinator = Readonly<{
  register(surface: AppSurface, handler: SurfaceLifecycleHandler): () => void
  leave(surface: AppSurface): Promise<boolean>
  beforeUnload(event: BeforeUnloadEvent): void
}>

export function createSurfaceLifecycleCoordinator(): SurfaceLifecycleCoordinator {
  const handlers = new Map<AppSurface, SurfaceLifecycleHandler>()

  return Object.freeze({
    register(surface, handler) {
      handlers.set(surface, handler)
      return () => {
        if (handlers.get(surface) === handler) handlers.delete(surface)
      }
    },
    async leave(surface) {
      return (await handlers.get(surface)?.leave()) ?? true
    },
    beforeUnload(event) {
      for (const handler of handlers.values()) handler.beforeUnload?.(event)
    },
  })
}
