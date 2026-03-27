import { buildThumbnailUrl, type MediaShareContext } from './build-media-url'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { getMediaType } from '@/lib/media-utils'
import { getSolidIconComponent } from './solid-available-icons'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import Book from 'lucide-solid/icons/book'
import BookOpen from 'lucide-solid/icons/book-open'
import Eye from 'lucide-solid/icons/eye'
import FileQuestion from 'lucide-solid/icons/file-question-mark'
import FileText from 'lucide-solid/icons/file-text'
import Folder from 'lucide-solid/icons/folder'
import ImageIcon from 'lucide-solid/icons/image'
import Link from 'lucide-solid/icons/link'
import Music from 'lucide-solid/icons/music'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import Star from 'lucide-solid/icons/star'
import Video from 'lucide-solid/icons/video'
import { Show, createSignal, type JSX } from 'solid-js'
import type { WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'

export type FileIconContext = {
  customIcons: Record<string, string>
  knowledgeBases: string[]
  playingPath: string | null
  currentFile: string | null
  mediaPlayerIsPlaying: boolean
  mediaType: 'audio' | 'video' | null
  mediaShare?: MediaShareContext
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
      return 'text-orange-500'
    case MediaType.OTHER:
    default:
      return 'text-yellow-500'
  }
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
  if (isVirtual && fp === norm(VIRTUAL_FOLDERS.SHARES)) {
    const customIconName = customIcons[filePath] ?? customIcons[fp]
    if (customIconName) {
      const CustomIcon = getSolidIconComponent(customIconName)
      if (CustomIcon) {
        return <CustomIcon class={`${cls} text-blue-500`} size={sz} />
      }
    }
    return <Link class={`${cls} text-blue-500`} size={sz} stroke-width={sw} />
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
): JSX.Element {
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

/** Standalone file browser / share browser without settings or player context. */
export function fileIcon(file: FileItem): JSX.Element {
  return fileItemIcon(file, EMPTY_FILE_ICON_CONTEXT)
}

function gridHeroIconScaleWrap(inner: JSX.Element): JSX.Element {
  return <div class='scale-[2.5] [&_svg]:h-6 [&_svg]:w-6'>{inner}</div>
}

function GridVideoThumbnail(props: { file: FileItem; ctx: FileIconContext }): JSX.Element {
  const [imgFailed, setImgFailed] = createSignal(false)
  const src = () => buildThumbnailUrl(props.file.path, props.ctx.mediaShare ?? null)

  return (
    <Show
      when={!imgFailed()}
      fallback={
        <div class='flex h-full min-h-full w-full items-center justify-center text-muted-foreground'>
          {gridHeroIconScaleWrap(fileItemIcon(props.file, props.ctx))}
        </div>
      }
    >
      <div class='absolute inset-0'>
        <img
          src={src()}
          alt=''
          loading='lazy'
          decoding='async'
          class='h-full w-full object-cover'
          data-testid='file-browser-video-thumbnail'
          onError={() => setImgFailed(true)}
        />
      </div>
    </Show>
  )
}

export function gridHeroIcon(
  file: FileItem,
  ctx: FileIconContext = EMPTY_FILE_ICON_CONTEXT,
): JSX.Element {
  const fp = norm(file.path)
  const customIconName = ctx.customIcons[file.path] ?? ctx.customIcons[fp]
  if (customIconName && getSolidIconComponent(customIconName)) {
    return gridHeroIconScaleWrap(fileItemIcon(file, ctx))
  }

  if (file.type === MediaType.VIDEO && !file.isDirectory && !file.isVirtual) {
    return <GridVideoThumbnail file={file} ctx={ctx} />
  }

  return gridHeroIconScaleWrap(fileItemIcon(file, ctx))
}

export function workspaceTabIcon(
  tab: WorkspaceWindowDefinition,
  ctx: FileIconContext,
  size: IconSize = 'sm',
): JSX.Element {
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

export function workspaceTaskbarRowIcon(
  tab: WorkspaceWindowDefinition,
  ctx: FileIconContext,
  playbackPath: string | null,
  size: IconSize = 'sm',
): JSX.Element {
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

export function pinnedShellIcon(
  pin: Pick<WorkspaceTaskbarPin, 'path' | 'isDirectory' | 'customIconName'>,
  settingsCustomIcons: Record<string, string>,
  ctx: FileIconContext,
): JSX.Element {
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
