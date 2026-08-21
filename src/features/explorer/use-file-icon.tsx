import { buildThumbnailUrl } from '@/lib/media/build-media-url'
import { thumbnailLoadQueue, type ThumbnailLoadTicket } from '@/lib/media/thumbnail-load-queue'
import { VIRTUAL_FOLDERS } from '@/lib/files/constants'
import { getMediaType } from '@/lib/media/media-utils'
import { getSolidIconComponent } from '@/lib/ui/solid-available-icons'
import type { FileItem } from '@/lib/files/types'
import { MediaType } from '@/lib/files/types'
import type { WindowDefinition } from '@/lib/models/window-model'
import Book from 'lucide-solid/icons/book'
import BookOpen from 'lucide-solid/icons/book-open'
import Eye from 'lucide-solid/icons/eye'
import FileQuestion from 'lucide-solid/icons/file-question-mark'
import FileText from 'lucide-solid/icons/file-text'
import Folder from 'lucide-solid/icons/folder'
import ImageIcon from 'lucide-solid/icons/image'
import Music from 'lucide-solid/icons/music'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import Star from 'lucide-solid/icons/star'
import Video from 'lucide-solid/icons/video'
import { Show, createEffect, createMemo, createSignal, onSettled, type Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import type { TaskbarPin } from '@/lib/models/taskbar-pins'
import { virtualAppearanceForPath, type VirtualAppearance } from './virtual-directory-appearance'
import Archive from 'lucide-solid/icons/archive'
import Bot from 'lucide-solid/icons/bot'
import FolderKanban from 'lucide-solid/icons/folder-kanban'
import MessageSquare from 'lucide-solid/icons/message-square'

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

export function fileIconContextEquals(a: FileIconContext, b: FileIconContext): boolean {
  return (
    a.customIcons === b.customIcons &&
    a.knowledgeBases === b.knowledgeBases &&
    a.playingPath === b.playingPath &&
    a.currentFile === b.currentFile &&
    a.mediaPlayerIsPlaying === b.mediaPlayerIsPlaying &&
    a.mediaType === b.mediaType
  )
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

function virtualAppearanceIcon(appearance: VirtualAppearance, size: IconSize): JSX.Element {
  const { cls, sz, sw } = sizeProps(size)
  const color = appearance.color
    ? ''
    : appearance.tone === 'violet'
      ? 'text-violet-500'
      : appearance.tone === 'indigo'
        ? 'text-indigo-500'
        : 'text-muted-foreground'
  const Icon =
    getSolidIconComponent(appearance.icon) ??
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
  isVirtual: boolean,
  ctx: FileIconContext,
  size: IconSize = 'md',
): JSX.Element {
  const { cls, sz, sw } = sizeProps(size)
  const fp = norm(filePath)
  const { customIcons, knowledgeBases, playingPath, currentFile, mediaPlayerIsPlaying, mediaType } =
    ctx

  if (isVirtual && fp === norm(VIRTUAL_FOLDERS.MOST_PLAYED)) {
    const customIconName = customIcons[filePath] ?? customIcons[fp]
    if (customIconName) {
      const CustomIcon = getSolidIconComponent(customIconName)
      if (CustomIcon) {
        return <CustomIcon class={`${cls} text-blue-500`} size={sz} />
      }
    }
    return <Eye class={`${cls} text-blue-500`} size={sz} stroke-width={sw} />
  }
  if (isVirtual && fp === norm(VIRTUAL_FOLDERS.FAVORITES)) {
    const customIconName = customIcons[filePath] ?? customIcons[fp]
    if (customIconName) {
      const CustomIcon = getSolidIconComponent(customIconName)
      if (CustomIcon) {
        return <CustomIcon class={`${cls} text-blue-500`} size={sz} />
      }
    }
    return <Star class={`${cls} text-blue-500`} size={sz} stroke-width={sw} />
  }
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

  if (!isVirtual && type === MediaType.FOLDER && knowledgeBases.some((kb) => norm(kb) === fp)) {
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

export function fileItemIcon(
  file: FileItem,
  ctx: FileIconContext,
  size: IconSize = 'md',
  appearance?: VirtualAppearance,
): JSX.Element {
  if (appearance) return virtualAppearanceIcon(appearance, size)
  return renderFileIcon(
    file.type,
    file.path,
    file.type === MediaType.AUDIO,
    file.type === MediaType.VIDEO,
    file.isVirtual ?? false,
    ctx,
    size,
  )
}

/** Standalone file browser without settings or player context. */
export function fileIcon(file: FileItem): JSX.Element {
  return fileItemIcon(file, EMPTY_FILE_ICON_CONTEXT)
}

function gridHeroIconScaleWrap(inner: JSX.Element): JSX.Element {
  return <div class='scale-[2.5] [&_svg]:h-6 [&_svg]:w-6'>{inner}</div>
}

function GridMediaThumbnail(props: { file: FileItem; ctx: FileIconContext }): JSX.Element {
  const [containerEl, setContainerEl] = createSignal<HTMLDivElement>()
  let loadTicket: ThumbnailLoadTicket | undefined
  const [imgFailed, setImgFailed] = createSignal(false)
  const [queuedSrc, setQueuedSrc] = createSignal<string | undefined>()
  const [settled, setSettled] = createSignal(false)
  const [attempt, setAttempt] = createSignal(0)
  const src = () => buildThumbnailUrl(props.file.path, props.file.version)
  const testId = () =>
    props.file.type === MediaType.IMAGE
      ? 'file-browser-image-thumbnail'
      : 'file-browser-video-thumbnail'

  function releaseLoadSlot() {
    loadTicket?.release()
    loadTicket = undefined
  }

  function cancelLoad() {
    loadTicket?.cancel()
    loadTicket = undefined
    setQueuedSrc(undefined)
  }

  onSettled(() => {
    setSettled(true)
  })

  createEffect(
    () => ({
      baseUrl: src(),
      retry: attempt(),
      isGenerated: props.file.thumbnailGenerated === true,
      settled: settled(),
      target: containerEl(),
    }),
    ({ baseUrl, retry, isGenerated, settled: isSettled, target }) => {
      const url = `${baseUrl}${retry ? `${baseUrl.includes('?') ? '&' : '?'}retry=${retry}` : ''}`
      let visible = false
      let settleTimer: number | undefined
      let observer: IntersectionObserver | undefined

      cancelLoad()
      setImgFailed(false)

      if (!isSettled) return undefined

      if (isGenerated) {
        setQueuedSrc(url)
        return undefined
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

      // eslint-disable-next-line solid/reactivity
      return () => {
        observer?.disconnect()
        clearSettleTimer()
        cancelLoad()
      }
    },
  )

  return (
    <Show when={!imgFailed()} fallback={<div class='h-full min-h-full w-full' />}>
      <div ref={setContainerEl} class='absolute inset-0'>
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
                if (attempt() === 0) {
                  setAttempt(1)
                } else {
                  setImgFailed(true)
                }
              }}
            />
          )}
        </Show>
      </div>
    </Show>
  )
}

export function gridHeroIcon(
  file: FileItem,
  ctx: FileIconContext = EMPTY_FILE_ICON_CONTEXT,
  appearance?: VirtualAppearance,
): JSX.Element {
  if (appearance) return gridHeroIconScaleWrap(virtualAppearanceIcon(appearance, 'md'))
  const fp = norm(file.path)
  const customIconName = ctx.customIcons[file.path] ?? ctx.customIcons[fp]
  if (customIconName && getSolidIconComponent(customIconName)) {
    return gridHeroIconScaleWrap(fileItemIcon(file, ctx))
  }

  if (
    (file.type === MediaType.VIDEO || file.type === MediaType.IMAGE) &&
    !file.isDirectory &&
    !file.isVirtual
  ) {
    return <GridMediaThumbnail file={file} ctx={ctx} />
  }

  return gridHeroIconScaleWrap(fileItemIcon(file, ctx))
}

export function GridHeroIcon(props: {
  file: FileItem
  context: Accessor<FileIconContext>
  appearance?: Accessor<VirtualAppearance | undefined>
}): JSX.Element {
  const isMediaThumbnail = createMemo(
    () =>
      (props.file.type === MediaType.VIDEO || props.file.type === MediaType.IMAGE) &&
      !props.file.isDirectory &&
      !props.file.isVirtual,
  )
  const icon = createMemo(() => gridHeroIcon(props.file, props.context(), props.appearance?.()))
  return (
    <Show when={isMediaThumbnail()} fallback={icon()}>
      <MediaGridHeroIcon file={props.file} context={props.context} />
    </Show>
  )
}

function MediaGridHeroIcon(props: {
  file: FileItem
  context: Accessor<FileIconContext>
}): JSX.Element {
  const customIcon = createMemo<JSX.Element | null>(() => {
    const fp = norm(props.file.path)
    const iconName = props.context().customIcons[props.file.path] ?? props.context().customIcons[fp]
    return iconName && getSolidIconComponent(iconName)
      ? gridHeroIconScaleWrap(fileItemIcon(props.file, props.context()))
      : null
  })
  return (
    <Show
      when={customIcon()}
      fallback={<GridMediaThumbnail file={props.file} ctx={EMPTY_FILE_ICON_CONTEXT} />}
    >
      {(icon) => icon()}
    </Show>
  )
}

export function windowIcon(
  tab: WindowDefinition,
  ctx: FileIconContext,
  size: IconSize = 'sm',
): JSX.Element {
  if (tab.initialState.readerKind) {
    const { cls, sz, sw } = sizeProps(size)
    return <BookOpen class={`${cls} text-orange-500`} size={sz} stroke-width={sw} />
  }
  const virtualAppearance = virtualAppearanceForPath(
    tab.iconPath ??
      (tab.type === 'hermes'
        ? `Hermes Sessions/session/${tab.hermes?.sessionId ?? tab.hermes?.draftId ?? 'draft'}`
        : ''),
  )
  if (virtualAppearance) return virtualAppearanceIcon(virtualAppearance, size)
  const iconType = tab.iconType ?? (tab.type === 'browser' ? MediaType.FOLDER : MediaType.OTHER)
  const iconPath = tab.iconPath ?? (tab.type === 'browser' ? (tab.initialState.dir ?? '') : '')
  return renderFileIcon(
    iconType,
    iconPath,
    iconType === MediaType.AUDIO,
    iconType === MediaType.VIDEO,
    tab.iconIsVirtual ?? false,
    ctx,
    size,
  )
}

export function taskbarWindowIcon(
  tab: WindowDefinition,
  ctx: FileIconContext,
  playbackPath: string | null,
  size: IconSize = 'sm',
): JSX.Element {
  if (tab.initialState.readerKind) {
    const { cls, sz, sw } = sizeProps(size)
    return <BookOpen class={`${cls} text-orange-500`} size={sz} stroke-width={sw} />
  }
  const virtualAppearance = virtualAppearanceForPath(
    tab.iconPath ??
      (tab.type === 'hermes'
        ? `Hermes Sessions/session/${tab.hermes?.sessionId ?? tab.hermes?.draftId ?? 'draft'}`
        : ''),
  )
  if (virtualAppearance) return virtualAppearanceIcon(virtualAppearance, size)
  const path =
    tab.iconPath ??
    (tab.type === 'browser'
      ? (tab.initialState.dir ?? '')
      : (tab.initialState.viewing ?? tab.initialState.playing ?? playbackPath ?? ''))
  const iconType =
    tab.iconType ??
    (tab.type === 'browser'
      ? MediaType.FOLDER
      : tab.initialState.viewing || tab.initialState.playing
        ? getMediaType(
            (tab.initialState.viewing ?? tab.initialState.playing ?? '').split('.').pop() ?? '',
          )
        : MediaType.OTHER)
  return renderFileIcon(
    iconType,
    path,
    iconType === MediaType.AUDIO,
    iconType === MediaType.VIDEO,
    tab.iconIsVirtual ?? false,
    ctx,
    size,
  )
}

export function pinnedItemIcon(
  pin: Pick<TaskbarPin, 'path' | 'isDirectory' | 'customIconName'>,
  settingsCustomIcons: Record<string, string>,
  ctx: FileIconContext,
): JSX.Element {
  const virtualAppearance = virtualAppearanceForPath(pin.path)
  if (virtualAppearance) return virtualAppearanceIcon(virtualAppearance, 'md')
  const p = norm(pin.path)
  const customName = pin.customIconName ?? settingsCustomIcons[pin.path] ?? settingsCustomIcons[p]
  const mediaType = pin.isDirectory
    ? MediaType.FOLDER
    : getMediaType(pin.path.split('.').pop() ?? '')
  if (customName) {
    const C = getSolidIconComponent(customName)
    if (C) {
      return <C class='h-5 w-5 text-muted-foreground' size={20} />
    }
  }
  return renderFileIcon(
    mediaType,
    pin.path,
    mediaType === MediaType.AUDIO,
    mediaType === MediaType.VIDEO,
    false,
    ctx,
  )
}
