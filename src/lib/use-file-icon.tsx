import { buildThumbnailUrl } from '@/lib/api-media-urls'
import { thumbnailLoadQueue, type ThumbnailLoadTicket } from './thumbnail-load-queue'
import { getMediaType } from '@/lib/media-utils'
import { getSolidIconComponent } from './solid-available-icons'
import { MediaType } from '@/lib/types'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { liveContentInstance } from '@/lib/content-window'
import Book from 'lucide-solid/icons/book'
import BookOpen from 'lucide-solid/icons/book-open'
import FileQuestion from 'lucide-solid/icons/file-question-mark'
import FileText from 'lucide-solid/icons/file-text'
import Folder from 'lucide-solid/icons/folder'
import ImageIcon from 'lucide-solid/icons/image'
import Music from 'lucide-solid/icons/music'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import Video from 'lucide-solid/icons/video'
import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js'
import type { WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'
import { workspaceTaskbarPinPath } from '@/lib/workspace-taskbar-pins'
import Archive from 'lucide-solid/icons/archive'
import Bot from 'lucide-solid/icons/bot'
import FolderKanban from 'lucide-solid/icons/folder-kanban'
import MessageSquare from 'lucide-solid/icons/message-square'
import { applicationContentRegistry } from '@/src/integrations/registry'
import {
  filesystemResourceAddress,
  type ResourceAppearance,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { filesystemPathForResourceKey } from '@/src/integrations/filesystem/resource'
import { FILESYSTEM_RENDERER_ID } from '@/src/integrations/filesystem/renderers'

export type FileIconContext = {
  customIcons: Record<string, string>
  knowledgeBases: string[]
  playingPath: string | null
  currentFile: string | null
  mediaPlayerIsPlaying: boolean
  mediaType: 'audio' | 'video' | null
}

export const EMPTY_FILE_ICON_CONTEXT: FileIconContext = {
  customIcons: {},
  knowledgeBases: [],
  playingPath: null,
  currentFile: null,
  mediaPlayerIsPlaying: false,
  mediaType: null,
}

function norm(p: string) {
  return p.replace(/\\/g, '/')
}

type IconSize = 'md' | 'sm'

function sizeProps(size: IconSize): { cls: string; sz: number; sw: number } {
  return size === 'sm' ? { cls: 'h-3.5 w-3.5', sz: 14, sw: 2 } : { cls: 'h-5 w-5', sz: 20, sw: 2 }
}

function colorClass(mediaType: MediaType): string {
  switch (mediaType) {
    case MediaType.FOLDER:
      return 'text-blue-500'
    case MediaType.AUDIO:
      return 'text-purple-500'
    case MediaType.VIDEO:
      return 'text-red-500'
    case MediaType.IMAGE:
      return 'text-green-500'
    case MediaType.TEXT:
      return 'text-cyan-500'
    case MediaType.PDF:
    case MediaType.BOOK:
      return 'text-orange-500'
    case MediaType.OTHER:
    default:
      return 'text-yellow-500'
  }
}

function resourceAppearanceIcon(appearance: ResourceAppearance, size: IconSize): JSX.Element {
  const { cls, sz, sw } = sizeProps(size)
  const color = appearance.color
    ? ''
    : appearance.tone === 'violet'
      ? 'text-violet-500'
      : appearance.tone === 'indigo'
        ? 'text-indigo-500'
        : 'text-muted-foreground'
  const Icon =
    getSolidIconComponent(appearance.icon ?? '') ??
    (appearance.icon === 'agent-directory'
      ? Bot
      : appearance.icon === 'agent-session'
        ? MessageSquare
        : appearance.icon === 'project'
          ? FolderKanban
          : appearance.icon === 'archive'
            ? Archive
            : FolderKanban)
  return (
    <Icon
      class={`${cls} ${color}`}
      style={appearance.color ? { color: appearance.color } : undefined}
      size={sz}
      stroke-width={sw}
    />
  )
}

function renderFileIcon(
  type: MediaType,
  filePath: string,
  isAudioFile: boolean,
  isVideoFile: boolean,
  ctx: FileIconContext,
  size: IconSize = 'md',
): JSX.Element {
  const { cls, sz, sw } = sizeProps(size)
  const fp = norm(filePath)
  const { customIcons, knowledgeBases, playingPath, currentFile, mediaPlayerIsPlaying, mediaType } =
    ctx

  const customIconName = customIcons[filePath] ?? customIcons[fp]
  if (customIconName) {
    const CustomIcon = getSolidIconComponent(customIconName)
    if (CustomIcon) {
      return <CustomIcon class={`${cls} ${colorClass(type)}`} size={sz} />
    }
  }

  const playPathNorm = playingPath ? norm(playingPath) : null
  const currentNorm = currentFile ? norm(currentFile) : null
  const isCurrentFile =
    playPathNorm !== null && currentNorm !== null && playPathNorm === fp && currentNorm === fp

  if (isCurrentFile && (isAudioFile || isVideoFile)) {
    const isActuallyPlaying =
      mediaPlayerIsPlaying &&
      ((isAudioFile && mediaType === 'audio') ||
        (isVideoFile && mediaType === 'video') ||
        (isVideoFile && mediaType === 'audio'))
    return isActuallyPlaying ? (
      <Play class={`${cls} text-primary`} size={sz} stroke-width={sw} />
    ) : (
      <Pause class={`${cls} text-primary`} size={sz} stroke-width={sw} />
    )
  }

  if (type === MediaType.FOLDER && knowledgeBases.some((kb) => norm(kb) === fp)) {
    return <BookOpen class={`${cls} text-primary`} size={sz} stroke-width={sw} />
  }

  switch (type) {
    case MediaType.FOLDER:
      return <Folder class={`${cls} text-blue-500`} size={sz} stroke-width={sw} />
    case MediaType.AUDIO:
      return <Music class={`${cls} text-purple-500`} size={sz} stroke-width={sw} />
    case MediaType.VIDEO:
      return <Video class={`${cls} text-red-500`} size={sz} stroke-width={sw} />
    case MediaType.IMAGE:
      return <ImageIcon class={`${cls} text-green-500`} size={sz} stroke-width={sw} />
    case MediaType.TEXT:
      return <FileText class={`${cls} text-cyan-500`} size={sz} stroke-width={sw} />
    case MediaType.PDF:
    case MediaType.BOOK:
      return <Book class={`${cls} text-orange-500`} size={sz} stroke-width={sw} />
    case MediaType.OTHER:
      return <FileQuestion class={`${cls} text-yellow-500`} size={sz} stroke-width={sw} />
    default:
      return <FileQuestion class={`${cls} text-yellow-500`} size={sz} stroke-width={sw} />
  }
}

function resourceFallbackType(resource: ResourceSummary): MediaType {
  const metadataType = resource.metadata?.fileType
  if (Object.values(MediaType).includes(metadataType as MediaType)) return metadataType as MediaType
  if (
    resource.capabilities.includes('browse') ||
    resource.presentation === 'browse' ||
    resource.kind === 'folder' ||
    resource.kind === 'root' ||
    resource.kind === 'collection'
  ) {
    return MediaType.FOLDER
  }
  switch (resource.presentation) {
    case 'audio':
      return MediaType.AUDIO
    case 'video':
      return MediaType.VIDEO
    case 'image':
      return MediaType.IMAGE
    case 'text':
      return MediaType.TEXT
    case 'pdf':
      return MediaType.PDF
    case 'book':
      return MediaType.BOOK
    default:
      return MediaType.OTHER
  }
}

function resourceIconContext(
  resource: ResourceSummary,
  path: string,
  ctx: FileIconContext,
): FileIconContext {
  const metadata = resource.metadata ?? {}
  return {
    ...ctx,
    customIcons:
      typeof metadata.customIcon === 'string'
        ? { ...ctx.customIcons, [path]: metadata.customIcon }
        : ctx.customIcons,
    knowledgeBases:
      metadata.knowledgeBase === true && !ctx.knowledgeBases.includes(path)
        ? [...ctx.knowledgeBases, path]
        : ctx.knowledgeBases,
  }
}

export function resourceSummaryIcon(
  resource: ResourceSummary,
  ctx: FileIconContext = EMPTY_FILE_ICON_CONTEXT,
  size: IconSize = 'md',
): JSX.Element {
  if (resource.appearance?.icon?.trim()) {
    return resourceAppearanceIcon(resource.appearance, size)
  }
  const path = filesystemPathForResourceKey(resource.key) ?? ''
  const type = resourceFallbackType(resource)
  return renderFileIcon(
    type,
    path,
    type === MediaType.AUDIO,
    type === MediaType.VIDEO,
    resourceIconContext(resource, path, ctx),
    size,
  )
}

function gridHeroIconScaleWrap(inner: JSX.Element): JSX.Element {
  return <div class='scale-[2.5] [&_svg]:h-6 [&_svg]:w-6'>{inner}</div>
}

function GridMediaThumbnail(props: {
  path: string
  type: MediaType
  thumbnailGenerated: boolean
}): JSX.Element {
  let containerEl: HTMLDivElement | undefined
  let loadTicket: ThumbnailLoadTicket | undefined
  const [imgFailed, setImgFailed] = createSignal(false)
  const [queuedSrc, setQueuedSrc] = createSignal<string | undefined>()
  const src = () => buildThumbnailUrl(props.path)
  const testId = () =>
    props.type === MediaType.IMAGE ? 'file-browser-image-thumbnail' : 'file-browser-video-thumbnail'

  function releaseLoadSlot() {
    loadTicket?.release()
    loadTicket = undefined
  }

  function cancelLoad() {
    loadTicket?.cancel()
    loadTicket = undefined
    setQueuedSrc(undefined)
  }

  createEffect(() => {
    const url = src()
    const isGenerated = props.thumbnailGenerated
    const target = containerEl
    let visible = false
    let settleTimer: number | undefined
    let observer: IntersectionObserver | undefined

    cancelLoad()
    setImgFailed(false)

    if (isGenerated) {
      setQueuedSrc(url)
      onCleanup(cancelLoad)
      return
    }

    function clearSettleTimer() {
      if (settleTimer === undefined) return
      window.clearTimeout(settleTimer)
      settleTimer = undefined
    }

    function enqueueLoad() {
      if (!visible || loadTicket) return
      loadTicket = thumbnailLoadQueue.enqueue(() => {
        if (!visible) {
          releaseLoadSlot()
          return
        }
        setQueuedSrc(url)
      })
    }

    function scheduleLoad() {
      clearSettleTimer()
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined
        enqueueLoad()
      }, 125)
    }

    if (target && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries.some((entry) => entry.isIntersecting)
          if (visible) {
            scheduleLoad()
          } else {
            clearSettleTimer()
            cancelLoad()
          }
        },
        { threshold: 0.01 },
      )
      observer.observe(target)
    } else {
      visible = true
      scheduleLoad()
    }

    onCleanup(() => {
      observer?.disconnect()
      clearSettleTimer()
      cancelLoad()
    })
  })

  return (
    <Show when={!imgFailed()} fallback={<div class='h-full min-h-full w-full' />}>
      <div ref={containerEl} class='absolute inset-0'>
        <Show when={queuedSrc()} fallback={<div class='h-full min-h-full w-full' />}>
          {(thumbnailSrc) => (
            <img
              src={thumbnailSrc()}
              alt=''
              loading='eager'
              decoding='async'
              class='h-full w-full object-cover'
              data-testid={testId()}
              onLoad={releaseLoadSlot}
              onError={() => {
                releaseLoadSlot()
                setImgFailed(true)
              }}
            />
          )}
        </Show>
      </div>
    </Show>
  )
}

export function gridResourceSummaryIcon(
  resource: ResourceSummary,
  ctx: FileIconContext = EMPTY_FILE_ICON_CONTEXT,
): JSX.Element {
  const path = filesystemPathForResourceKey(resource.key)
  const type = resourceFallbackType(resource)
  if (path !== null && (type === MediaType.VIDEO || type === MediaType.IMAGE)) {
    return (
      <GridMediaThumbnail
        path={path}
        type={type}
        thumbnailGenerated={resource.metadata?.thumbnailGenerated === true}
      />
    )
  }
  if (resource.appearance?.icon?.trim()) {
    return gridHeroIconScaleWrap(resourceAppearanceIcon(resource.appearance, 'md'))
  }
  const iconContext = resourceIconContext(resource, path ?? '', ctx)
  const normalizedPath = norm(path ?? '')
  const customIconName =
    iconContext.customIcons[path ?? ''] ?? iconContext.customIcons[normalizedPath]
  if (customIconName && getSolidIconComponent(customIconName)) {
    return gridHeroIconScaleWrap(resourceSummaryIcon(resource, iconContext))
  }
  return gridHeroIconScaleWrap(resourceSummaryIcon(resource, iconContext))
}

function registeredContentIcon(tab: WorkspaceWindowDefinition, size: IconSize): JSX.Element | null {
  const instance = liveContentInstance(tab)
  if (!instance) return null
  const presentation = applicationContentRegistry.presentation(instance)
  if (!presentation?.icon) return null
  return resourceAppearanceIcon(
    {
      icon: presentation.icon,
      tone: presentation.icon === 'project' ? 'indigo' : 'violet',
    },
    size,
  )
}

function windowIconDetails(tab: WorkspaceWindowDefinition): {
  path: string
  type: MediaType
  reader: boolean
} {
  const instance = liveContentInstance(tab)
  if (instance?.type === 'explorer') {
    return {
      path: filesystemResourceAddress(instance.location)?.path ?? '',
      type: MediaType.FOLDER,
      reader: false,
    }
  }
  if (instance?.type === 'resource') {
    const path = filesystemResourceAddress(instance.resource)?.path ?? ''
    const reader =
      instance.renderer === FILESYSTEM_RENDERER_ID.folderReader ||
      instance.renderer === FILESYSTEM_RENDERER_ID.pdf ||
      instance.renderer === FILESYSTEM_RENDERER_ID.book
    const type =
      instance.renderer === FILESYSTEM_RENDERER_ID.video
        ? MediaType.VIDEO
        : instance.renderer === FILESYSTEM_RENDERER_ID.audio
          ? MediaType.AUDIO
          : instance.renderer === FILESYSTEM_RENDERER_ID.image
            ? MediaType.IMAGE
            : instance.renderer === FILESYSTEM_RENDERER_ID.text
              ? MediaType.TEXT
              : instance.renderer === FILESYSTEM_RENDERER_ID.pdf
                ? MediaType.PDF
                : instance.renderer === FILESYSTEM_RENDERER_ID.book
                  ? MediaType.BOOK
                  : instance.renderer === FILESYSTEM_RENDERER_ID.folderReader
                    ? MediaType.FOLDER
                    : getMediaType(path.split('.').pop() ?? '')
    return { path, type, reader }
  }
  return { path: '', type: MediaType.OTHER, reader: false }
}

export function workspaceTabIcon(
  tab: WorkspaceWindowDefinition,
  ctx: FileIconContext,
  size: IconSize = 'sm',
): JSX.Element {
  const details = windowIconDetails(tab)
  if (details.reader) {
    const { cls, sz, sw } = sizeProps(size)
    return <BookOpen class={`${cls} text-orange-500`} size={sz} stroke-width={sw} />
  }
  const contentIcon = registeredContentIcon(tab, size)
  if (contentIcon) return contentIcon
  return renderFileIcon(
    details.type,
    details.path,
    details.type === MediaType.AUDIO,
    details.type === MediaType.VIDEO,
    ctx,
    size,
  )
}

export function workspaceTaskbarRowIcon(
  tab: WorkspaceWindowDefinition,
  ctx: FileIconContext,
  playbackPath: string | null,
  size: IconSize = 'sm',
): JSX.Element {
  const details = windowIconDetails(tab)
  if (details.reader) {
    const { cls, sz, sw } = sizeProps(size)
    return <BookOpen class={`${cls} text-orange-500`} size={sz} stroke-width={sw} />
  }
  const contentIcon = registeredContentIcon(tab, size)
  if (contentIcon) return contentIcon
  const path = details.path || playbackPath || ''
  return renderFileIcon(
    details.type,
    path,
    details.type === MediaType.AUDIO,
    details.type === MediaType.VIDEO,
    ctx,
    size,
  )
}

export function pinnedShellIcon(
  pin: WorkspaceTaskbarPin,
  resource: ResourceSummary | undefined,
  settingsCustomIcons: Record<string, string>,
  ctx: FileIconContext,
): JSX.Element {
  const path = workspaceTaskbarPinPath(pin)
  const p = path === null ? null : norm(path)
  const customName =
    pin.customIconName ??
    (path === null ? undefined : (settingsCustomIcons[path] ?? settingsCustomIcons[p!]))
  const iconPath = path ?? pin.title
  const mediaType = resource
    ? resourceFallbackType(resource)
    : getMediaType(iconPath.split('.').pop() ?? '')
  if (customName) {
    const C = getSolidIconComponent(customName)
    if (C) {
      return <C class='h-5 w-5 text-muted-foreground' size={20} />
    }
  }
  return renderFileIcon(
    mediaType,
    iconPath,
    mediaType === MediaType.AUDIO,
    mediaType === MediaType.VIDEO,
    ctx,
  )
}
