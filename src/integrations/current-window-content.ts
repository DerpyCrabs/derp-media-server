import {
  isContentInstance,
  type ContentInstance,
  type PersistedContentEnvelope,
} from '@/lib/domain/content'
import type { ContentWindowDefinition } from '@/lib/content-window'
import { filesystemResourceAddress } from '@/lib/domain/resource'
import { installContentWindowPersistencePort } from '@/lib/content-window-persistence'
import { applicationContentRegistry } from '@/src/integrations/registry'

export type CurrentContentWindow = Readonly<{
  id: string
  title?: unknown
  contentInstance?: unknown
  content?: unknown
}>

export type CurrentWindowDecodeResult =
  | Readonly<{ ok: true; instance: ContentInstance }>
  | Readonly<{ ok: false; reason: string; recoverable: unknown }>

export function persistedContentForInstance(
  instance: ContentInstance,
): PersistedContentEnvelope | null {
  if (!applicationContentRegistry.isDurable(instance)) return null
  try {
    return applicationContentRegistry.encode(instance)
  } catch {
    return null
  }
}

export function contentWithInstanceId(instance: ContentInstance, id: string): ContentInstance {
  return { ...instance, id }
}

export function contentWindowFilesystemPath(window: CurrentContentWindow): string | null {
  const instance = contentInstanceFromCurrentWindow(window)
  const key =
    instance?.type === 'explorer'
      ? instance.location
      : instance?.type === 'resource'
        ? instance.resource
        : null
  return key ? (filesystemResourceAddress(key)?.path ?? null) : null
}

export function contentWindowFilesystemDirectory(window: CurrentContentWindow): string | null {
  const instance = contentInstanceFromCurrentWindow(window)
  if (instance?.type === 'explorer') {
    return filesystemResourceAddress(instance.location)?.path ?? null
  }
  if (instance?.type !== 'resource') return null
  if (instance.context) return filesystemResourceAddress(instance.context)?.path ?? null
  const path = filesystemResourceAddress(instance.resource)?.path
  return path?.replace(/\\/g, '/').split('/').slice(0, -1).join('/') ?? null
}

export function contentInstanceFromCurrentWindow(
  window: CurrentContentWindow,
): ContentInstance | null {
  if (isContentInstance(window.contentInstance) && window.contentInstance.id === window.id) {
    return window.contentInstance
  }
  if (window.content === undefined) return null
  const decoded = applicationContentRegistry.decode(window.content)
  return decoded.ok && decoded.instance.id === window.id ? decoded.instance : null
}

export function contentWindowWithInstance<T extends CurrentContentWindow>(
  window: T,
  instance: ContentInstance,
): (T & { contentInstance: ContentInstance; content?: PersistedContentEnvelope }) | null {
  if (instance.id !== window.id) return null
  const content = persistedContentForInstance(instance)
  const presentation = applicationContentRegistry.presentation(instance)
  return {
    ...window,
    ...(presentation?.title ? { title: presentation.title } : {}),
    ...(presentation?.icon ? { iconName: presentation.icon } : {}),
    contentInstance: instance,
    content: content ?? undefined,
  }
}

export function isRuntimeOnlyContentWindow(window: CurrentContentWindow): boolean {
  const instance = contentInstanceFromCurrentWindow(window)
  return instance !== null && applicationContentRegistry.preservesRuntime(instance)
}

export function persistedContentFromCurrentWindow(
  window: CurrentContentWindow,
): PersistedContentEnvelope | null {
  const instance = contentInstanceFromCurrentWindow(window)
  return instance ? persistedContentForInstance(instance) : null
}

export function currentWindowFromPersistedContent(
  content: unknown,
  fallback: Readonly<{ id: string }>,
): CurrentWindowDecodeResult {
  const decoded = applicationContentRegistry.decode(content)
  if (!decoded.ok) return decoded
  if (decoded.instance.id !== fallback.id) {
    return {
      ok: false,
      reason: 'Content instance id does not match its host window',
      recoverable: content,
    }
  }
  return { ok: true, instance: decoded.instance }
}

installContentWindowPersistencePort({
  contentInstance: contentInstanceFromCurrentWindow,
  encode: persistedContentFromCurrentWindow,
  decode: currentWindowFromPersistedContent,
  isRuntimeOnly: isRuntimeOnlyContentWindow,
})
