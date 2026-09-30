import { type Snapshot, domBinding, localComponent, view, type JSX } from 'effectweb'
import { buildThumbnailUrl } from '@/lib/media/build-media-url'
import { thumbnailBinding } from './thumbnail-binding'
import { VIRTUAL_FOLDERS } from '@/lib/files/constants'
import { getMediaType } from '@/lib/media/media-utils'
import { getIconComponent } from '@/lib/ui/available-icons'
import type { FileItem } from '@/lib/files/types'
import { MediaType } from '@/lib/files/types'
import type { WindowDefinition } from '@/lib/models/window-model'
import Book from '@effectweb/lucide/icons/book'
import BookOpen from '@effectweb/lucide/icons/book-open'
import Eye from '@effectweb/lucide/icons/eye'
import FileQuestion from '@effectweb/lucide/icons/file-question-mark'
import FileText from '@effectweb/lucide/icons/file-text'
import Folder from '@effectweb/lucide/icons/folder'
import ImageIcon from '@effectweb/lucide/icons/image'
import Music from '@effectweb/lucide/icons/music'
import Pause from '@effectweb/lucide/icons/pause'
import Play from '@effectweb/lucide/icons/play'
import Star from '@effectweb/lucide/icons/star'
import Video from '@effectweb/lucide/icons/video'
import type { TaskbarPin } from '@/lib/models/taskbar-pins'
import { virtualAppearanceForPath, type VirtualAppearance } from './virtual-directory-appearance'
import Archive from '@effectweb/lucide/icons/archive'
import Bot from '@effectweb/lucide/icons/bot'
import FolderKanban from '@effectweb/lucide/icons/folder-kanban'
import MessageSquare from '@effectweb/lucide/icons/message-square'
export type FileIconContext = {
  customIcons: Readonly<Record<string, string>>
  knowledgeBases: readonly string[]
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
    getIconComponent(appearance.icon) ??
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
      const CustomIcon = getIconComponent(customIconName)
      if (CustomIcon) {
        return <CustomIcon class={`${cls} text-blue-500`} size={sz} />
      }
    }
    return <Eye class={`${cls} text-blue-500`} size={sz} stroke-width={sw} />
  }
  if (isVirtual && fp === norm(VIRTUAL_FOLDERS.FAVORITES)) {
    const customIconName = customIcons[filePath] ?? customIcons[fp]
    if (customIconName) {
      const CustomIcon = getIconComponent(customIconName)
      if (CustomIcon) {
        return <CustomIcon class={`${cls} text-blue-500`} size={sz} />
      }
    }
    return <Star class={`${cls} text-blue-500`} size={sz} stroke-width={sw} />
  }
  const customIconName = customIcons[filePath] ?? customIcons[fp]
  if (customIconName) {
    const CustomIcon = getIconComponent(customIconName)
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
const GridMediaThumbnail = localComponent({
  init: (_props: Snapshot<{ file: FileItem; ctx: FileIconContext }>) => ({
    queuedSrc: undefined as string | undefined,
    failed: false,
    attempt: 0,
  }),
  identity: (props) => `${props.file.path}:${props.file.version ?? ''}`,
  view: view((model, patch) => {
    const file = model.props.file
    const base = buildThumbnailUrl(file.path, file.version)
    const url = `${base}${model.attempt ? `${base.includes('?') ? '&' : '?'}retry=${model.attempt}` : ''}`
    return (
      <div
        class='absolute inset-0'
        use={domBinding(
          { url, generated: file.thumbnailGenerated === true, patch },
          thumbnailBinding,
        )}
      >
        {model.queuedSrc && !model.failed ? (
          <img
            src={model.queuedSrc}
            alt=''
            loading='eager'
            decoding='async'
            class='h-full w-full object-cover'
            data-testid={
              file.type === MediaType.IMAGE
                ? 'file-browser-image-thumbnail'
                : 'file-browser-video-thumbnail'
            }
            onError={() => patch(model.attempt === 0 ? { attempt: 1 } : { failed: true })}
          />
        ) : (
          <div class='h-full min-h-full w-full' />
        )}
      </div>
    )
  }),
})
export function gridHeroIcon(
  file: FileItem,
  ctx: FileIconContext = EMPTY_FILE_ICON_CONTEXT,
  appearance?: VirtualAppearance,
): JSX.Element {
  if (appearance) return gridHeroIconScaleWrap(virtualAppearanceIcon(appearance, 'md'))
  const fp = norm(file.path)
  const customIconName = ctx.customIcons[file.path] ?? ctx.customIcons[fp]
  if (customIconName && getIconComponent(customIconName)) {
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
export const GridHeroIcon = view<{
  file: FileItem
  context: FileIconContext
  appearance?: VirtualAppearance | undefined
}>((props) => {
  const isMediaThumbnail = () =>
    (props.file.type === MediaType.VIDEO || props.file.type === MediaType.IMAGE) &&
    !props.file.isDirectory &&
    !props.file.isVirtual
  const icon = () => gridHeroIcon(props.file, props.context, props.appearance)
  return isMediaThumbnail() ? (
    <MediaGridHeroIcon file={props.file} context={props.context} />
  ) : (
    icon()
  )
})
const MediaGridHeroIcon = view<{ file: FileItem; context: FileIconContext }>((props) => {
  const customIcon = () => {
    const fp = norm(props.file.path)
    const iconName = props.context.customIcons[props.file.path] ?? props.context.customIcons[fp]
    return iconName && getIconComponent(iconName)
      ? gridHeroIconScaleWrap(fileItemIcon(props.file, props.context))
      : null
  }
  return customIcon() ?? <GridMediaThumbnail file={props.file} ctx={EMPTY_FILE_ICON_CONTEXT} />
})
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
    const C = getIconComponent(customName)
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
