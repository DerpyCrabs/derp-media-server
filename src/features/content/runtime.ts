import type { ContentInstance } from '@/lib/domain/content'
import type { JSX } from 'solid-js'
import type { ContentRendererDescriptor } from './contracts'
import type { ContentRegistry } from './registry'
import type {
  ContentRendererModule,
  ContentRendererMountCallbacks,
} from '../open/renderer-registry'
import { isContentRendererModule } from '../open/renderer-registry'

export type ContentResolution =
  | Readonly<{
      ok: true
      instance: ContentInstance
      renderer: ContentRendererDescriptor
    }>
  | Readonly<{
      ok: false
      reason: string
      recoverable: ContentInstance
    }>

export type ContentRuntime = Readonly<{
  resolve(instance: ContentInstance): ContentResolution
  loadRenderer(instance: ContentInstance): Promise<ContentRendererModule>
  mount(
    instance: ContentInstance | (() => ContentInstance),
    callbacks: ContentRendererMountCallbacks,
  ): Promise<ContentMountResult>
  canClose(instance: ContentInstance): Promise<boolean>
  release(instance: ContentInstance): Promise<boolean>
}>

export type ContentMountResult =
  | Readonly<{
      ok: true
      instance: ContentInstance
      renderer: string
      render: () => JSX.Element
    }>
  | Readonly<{
      ok: false
      reason: string
      recoverable: ContentInstance
    }>

export function contentRuntimeIdentity(instance: ContentInstance): string {
  switch (instance.type) {
    case 'explorer':
      return `explorer:${instance.location.provider}:${instance.location.id}`
    case 'resource':
      return `resource:${instance.resource.provider}:${instance.resource.id}:${instance.renderer}`
    case 'integration':
      return `integration:${instance.integration}:${instance.view}`
  }
}

export function createContentRuntime(registry: ContentRegistry): ContentRuntime {
  const rendererLoads = new Map<string, Promise<ContentRendererModule>>()

  return Object.freeze({
    resolve(instance) {
      const sanitized = registry.sanitize(instance)
      if (!sanitized) {
        return {
          ok: false,
          reason: 'Content rejected by sanitizer',
          recoverable: instance,
        }
      }
      const renderer = registry.renderer(sanitized)
      if (!renderer) {
        return {
          ok: false,
          reason: 'Content renderer unavailable',
          recoverable: instance,
        }
      }
      return { ok: true, instance: sanitized, renderer }
    },
    loadRenderer(instance) {
      const resolved = this.resolve(instance)
      if (!resolved.ok) return Promise.reject(new Error(resolved.reason))
      const id = resolved.renderer.id
      const cached = rendererLoads.get(id)
      if (cached) return cached
      const pending = resolved.renderer
        .load()
        .then((module) => {
          if (!isContentRendererModule(module)) {
            throw new Error(`Renderer ${id} returned an invalid module`)
          }
          return module
        })
        .catch((error) => {
          rendererLoads.delete(id)
          throw error
        })
      rendererLoads.set(id, pending)
      return pending
    },
    async mount(instance, callbacks) {
      const readInstance = typeof instance === 'function' ? instance : () => instance
      const initialInstance = readInstance()
      const resolved = this.resolve(initialInstance)
      if (!resolved.ok) return resolved
      try {
        const module = await this.loadRenderer(resolved.instance)
        if (module.kind === 'playback') {
          return {
            ok: false,
            reason: `Renderer ${resolved.renderer.id} requires surface playback presentation`,
            recoverable: initialInstance,
          }
        }
        return {
          ok: true,
          instance: resolved.instance,
          renderer: resolved.renderer.id,
          render: () =>
            module.mount({
              ...callbacks,
              instance: () => {
                const current = this.resolve(readInstance())
                return current.ok && current.renderer.id === resolved.renderer.id
                  ? current.instance
                  : resolved.instance
              },
              active: callbacks.active ?? (() => true),
            }),
        }
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
          recoverable: initialInstance,
        }
      }
    },
    async canClose(instance) {
      return (await registry.lifecycle(instance)?.canClose?.(instance)) ?? true
    },
    async release(instance) {
      const dispose = registry.lifecycle(instance)?.dispose
      if (!dispose) return false
      await dispose(instance)
      return true
    },
  })
}
