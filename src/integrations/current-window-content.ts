import {
  isContentInstance,
  type ContentInstance,
  type PersistedContentEnvelope,
} from '@/lib/domain/content'
import { filesystemResourceAddress } from '@/lib/domain/resource'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType, type MediaType as MediaTypeValue } from '@/lib/types'
import { BUILT_IN_RENDERER_ID } from '../features/open/renderer-registry'
import { applicationContentRegistry } from '@/src/integrations/registry'
import { FILESYSTEM_CONTENT_CODEC_ID } from '@/src/integrations/filesystem/module'
import {
  HERMES_PROVIDER,
  hermesLegacyPathForResourceKey,
  hermesResourceKeyFromLegacyPath,
  normalizeHermesContentState,
  type HermesContentState,
} from '@/src/integrations/hermes/module'
import { deletedHermesSessionIds } from '@/lib/hermes-session-store'

type RecordValue = Record<string, unknown>

export type CurrentContentWindow = Readonly<{
  id: string
  type?: unknown
  title?: unknown
  source?: unknown
  initialState?: unknown
  iconPath?: unknown
  iconType?: unknown
  runtimeContent?: unknown
  content?: unknown
}>

export type CurrentWindowProjection = Readonly<{
  type: 'browser' | 'viewer' | 'integration'
  source: Readonly<{ kind: 'local'; rootPath?: string | null }>
  initialState: Readonly<{
    dir?: string | null
    viewing?: string | null
    readerKind?: 'pdf' | 'folder' | 'book' | null
  }>
  iconPath?: string | null
  iconType?: MediaTypeValue | null
  iconIsVirtual?: boolean
  runtimeContent: ContentInstance
}>

export type CurrentWindowDecodeResult =
  | Readonly<{
      ok: true
      instance: ContentInstance
      projection: CurrentWindowProjection
    }>
  | Readonly<{ ok: false; reason: string; recoverable: unknown }>

function record(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null
}

const DISALLOWED_PERSISTED_WINDOW_FIELDS = [
  'type',
  'source',
  'initialState',
  'hermes',
  'runtimeContent',
  'iconPath',
  'iconType',
  'iconIsVirtual',
] as const

export function hasDisallowedPersistedContentFields(value: Record<string, unknown>): boolean {
  return DISALLOWED_PERSISTED_WINDOW_FIELDS.some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  )
}

function rendererMediaType(renderer: string, path: string): MediaTypeValue {
  switch (renderer) {
    case BUILT_IN_RENDERER_ID.video:
      return MediaType.VIDEO
    case BUILT_IN_RENDERER_ID.audio:
      return MediaType.AUDIO
    case BUILT_IN_RENDERER_ID.image:
      return MediaType.IMAGE
    case BUILT_IN_RENDERER_ID.text:
      return MediaType.TEXT
    case BUILT_IN_RENDERER_ID.pdf:
      return MediaType.PDF
    case BUILT_IN_RENDERER_ID.book:
      return MediaType.BOOK
    case BUILT_IN_RENDERER_ID.folderReader:
      return MediaType.FOLDER
    default:
      return getMediaTypeFromPath(path)
  }
}

function readerKind(renderer: string): 'pdf' | 'folder' | 'book' | null {
  switch (renderer) {
    case BUILT_IN_RENDERER_ID.pdf:
      return 'pdf'
    case BUILT_IN_RENDERER_ID.folderReader:
      return 'folder'
    case BUILT_IN_RENDERER_ID.book:
      return 'book'
    default:
      return null
  }
}

function directoryForPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  parts.pop()
  return parts.join('/')
}

export function currentWindowProjectionForContent(
  instance: ContentInstance,
): CurrentWindowProjection | null {
  if (instance.type === 'explorer') {
    const filesystemAddress = filesystemResourceAddress(instance.location)
    const hermesPath = hermesLegacyPathForResourceKey(instance.location)
    const path = filesystemAddress?.path ?? hermesPath
    if (path === null || path === undefined) return null
    return {
      type: 'browser',
      source: { kind: 'local', rootPath: null },
      initialState: { dir: path },
      iconPath: path || null,
      iconType: MediaType.FOLDER,
      runtimeContent: instance,
      ...(hermesPath === null ? {} : { iconIsVirtual: true }),
    }
  }
  if (instance.type === 'resource') {
    const address = filesystemResourceAddress(instance.resource)
    if (!address) return null
    const kind = readerKind(instance.renderer)
    const context = instance.context ? filesystemResourceAddress(instance.context) : null
    return {
      type: 'viewer',
      source: { kind: 'local', rootPath: null },
      initialState: {
        viewing: address.path,
        dir: context?.path ?? directoryForPath(address.path),
        ...(kind ? { readerKind: kind } : {}),
      },
      iconPath: address.path,
      iconType: rendererMediaType(instance.renderer, address.path),
      runtimeContent: instance,
    }
  }
  if (
    instance.type === 'integration' &&
    instance.integration === HERMES_PROVIDER &&
    instance.view === 'chat'
  ) {
    const state = record(instance.state) as HermesContentState | null
    if (!state || (!state.sessionId && !state.draftId)) return null
    return {
      type: 'integration',
      source: { kind: 'local', rootPath: null },
      initialState: {},
      iconIsVirtual: true,
      runtimeContent: {
        ...instance,
        state: { ...state, readOnly: state.readOnly ?? false },
      },
    }
  }
  return null
}

export function persistedContentForInstance(
  instance: ContentInstance,
): PersistedContentEnvelope | null {
  if (
    instance.type === 'integration' &&
    instance.integration === HERMES_PROVIDER &&
    instance.view === 'chat'
  ) {
    const state = normalizeHermesContentState(instance.state)
    if (state?.sessionId && deletedHermesSessionIds.has(state.sessionId)) return null
  }
  try {
    return applicationContentRegistry.encode(instance)
  } catch {
    return null
  }
}

export function contentWithInstanceId(instance: ContentInstance, id: string): ContentInstance {
  return { ...instance, id }
}

export function isRuntimeOnlyContentWindow(window: CurrentContentWindow): boolean {
  const instance = contentInstanceFromCurrentWindow(window)
  if (
    instance?.type !== 'integration' ||
    instance.integration !== HERMES_PROVIDER ||
    instance.view !== 'chat'
  ) {
    return false
  }
  const state = normalizeHermesContentState(instance.state)
  return !!state?.draftId && !state.sessionId
}

export function projectContentOntoCurrentWindow<T extends CurrentContentWindow>(
  window: T,
  instance: ContentInstance,
): (T & CurrentWindowProjection & { content?: PersistedContentEnvelope }) | null {
  if (instance.id !== window.id) return null
  const projection = currentWindowProjectionForContent(instance)
  if (!projection) return null
  const content = persistedContentForInstance(instance)
  const presentation = applicationContentRegistry.presentation(instance)
  return {
    ...window,
    ...projection,
    ...(presentation?.title ? { title: presentation.title } : {}),
    content: content ?? undefined,
  }
}

export function contentInstanceFromCurrentWindow(
  window: CurrentContentWindow,
): ContentInstance | null {
  const projected = contentInstanceFromCurrentProjection(window)
  if (projected) return projected
  if (window.content !== undefined) {
    const decoded = applicationContentRegistry.decode(window.content)
    if (decoded.ok && decoded.instance.id === window.id) return decoded.instance
  }
  return null
}

function contentInstanceFromCurrentProjection(
  window: CurrentContentWindow,
): ContentInstance | null {
  if (
    window.type === 'integration' &&
    isContentInstance(window.runtimeContent) &&
    window.runtimeContent.id === window.id
  ) {
    return window.runtimeContent
  }
  if (window.type === 'browser') {
    const initialState = record(window.initialState)
    const path = typeof initialState?.dir === 'string' ? initialState.dir : null
    const location = path === null ? null : hermesResourceKeyFromLegacyPath(path)
    if (location) return { id: window.id, type: 'explorer', location }
  }
  const codec = applicationContentRegistry.codec(FILESYSTEM_CONTENT_CODEC_ID)
  if (!codec) return null
  const decoded = codec.decode(window)
  if (decoded.ok && decoded.instance.id === window.id) return decoded.instance
  return isContentInstance(window.runtimeContent) && window.runtimeContent.id === window.id
    ? window.runtimeContent
    : null
}

/** Bounded Stage 3 adapter. New callers persist only the returned envelope. */
export function persistedContentFromCurrentWindow(
  window: CurrentContentWindow,
): PersistedContentEnvelope | null {
  // Current hosts still mutate their temporary projection fields directly. Prefer that live
  // projection so a restored envelope cannot overwrite later navigation on the next save.
  const instance =
    contentInstanceFromCurrentProjection(window) ?? contentInstanceFromCurrentWindow(window)
  return instance ? persistedContentForInstance(instance) : null
}

/** Restores temporary host fields consumed by current Workspace/Canvas layout code. */
export function currentWindowFromPersistedContent(
  content: unknown,
  fallback: Readonly<{ id: string; title?: unknown }>,
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
  const projection = currentWindowProjectionForContent(decoded.instance)
  if (!projection) {
    return {
      ok: false,
      reason: 'Content cannot be projected into the current window host',
      recoverable: content,
    }
  }
  return { ok: true, instance: decoded.instance, projection }
}
