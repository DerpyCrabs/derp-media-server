import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { useVideoPlaybackTime } from '@/lib/use-video-playback-time'
import { useWorkspaceAudio } from '@/lib/workspace-audio-store'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import {
  createTextDocumentTarget,
  enqueueTextDocumentSave,
  textDocumentDraftScope,
  textDocumentTargetKey,
  type TextDocumentTarget,
} from '@/lib/text-document-target'
import { queryKeys } from '@/lib/query-keys'
import { fileDownloadHref } from '@/lib/download-urls'
import { getMediaType, getMediaTypeFromPath } from '@/lib/media-utils'
import { stripSharePrefix } from '@/lib/source-context'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { buildResolveMarkdownImageUrl } from '@/lib/resolve-markdown-image-url'
import { tryPasteKnowledgeBaseImage } from '@/lib/handle-kb-image-paste'
import { isPathEditable } from '@/lib/utils'
import {
  readTextEditorDraft,
  removeTextEditorDraft,
  textEditorDraftKey,
  writeTextEditorDraft,
} from '@/lib/text-editor-draft'
import AlertCircle from 'lucide-solid/icons/alert-circle'
import Download from 'lucide-solid/icons/download'
import Headphones from 'lucide-solid/icons/headphones'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import Music2 from 'lucide-solid/icons/music-2'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import RotateCw from 'lucide-solid/icons/rotate-cw'
import Volume2 from 'lucide-solid/icons/volume-2'
import VolumeX from 'lucide-solid/icons/volume-x'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import type { Accessor } from 'solid-js'
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  type JSX,
} from 'solid-js'
import {
  buildAdminMediaUrl,
  buildAudioMetadataUrl,
  buildShareMediaUrl,
} from '../lib/build-media-url'
import { createResponsiveImage } from '../lib/responsive-image'
import { LazyMarkdownDocument } from '../media/LazyMarkdownDocument'
import { completeMarkdownImagePaste } from '../media/markdown/paste-completion'
import type { TextViewerShareContext } from '../media/TextViewerDialog'
import type { WorkspaceShareConfig } from './workspace-browser-pane-types'

const ReaderDialog = lazy(() =>
  import('../reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
)

export type WorkspaceVideoListenOnlyDetail = {
  path: string
  dir?: string
  videoCurrentTime: number
}

type Props = {
  windowId: string
  storageKey: string
  contentVisible: Accessor<boolean>
  workspace: Accessor<PersistedWorkspaceState | null>
  sharePanel: Accessor<WorkspaceShareConfig | null>
  editableFolders: string[]
  /** Same as main file browser — required for Obsidian-style images in knowledge bases. */
  knowledgeBases?: string[]
  shareCanEdit: boolean
  shareCanUpload: boolean
  onUpdateViewing: (windowId: string, path: string) => void
  onVideoMetadataLoaded?: (videoWidth: number, videoHeight: number) => void
  autoPlayVideo?: boolean
  /** Hand off video audio to taskbar; parent sets transport + closes tab if needed. */
  onListenOnlyHandoff?: (detail: WorkspaceVideoListenOnlyDetail) => void
  /** Close the viewer tab after switching to taskbar audio (playback keeps running). */
  onListenOnlyDismissViewer?: () => void
  showListenOnly?: boolean
  onAudioPlay?: (element: HTMLAudioElement) => void
  onAudioPause?: (element: HTMLAudioElement) => void
}

type WorkspaceTextSaveQueryKey =
  | ReturnType<typeof queryKeys.textContent>
  | ReturnType<typeof queryKeys.shareText>

type WorkspaceTextSaveVariables = {
  content: string
  target: TextDocumentTarget
  queryKey: WorkspaceTextSaveQueryKey
}

function shareEditRelativePath(viewingPath: string, sharePath: string): string {
  const sp = sharePath.replace(/\\/g, '/')
  const fileFwd = viewingPath.replace(/\\/g, '/')
  return fileFwd.startsWith(sp + '/') ? fileFwd.slice(sp.length + 1) : fileFwd
}

type AudioMetadata = {
  title?: string
  artist?: string
  album?: string
  coverArt?: string | null
  duration?: number
}

async function fetchAudioMetadata(url: string): Promise<AudioMetadata> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch audio metadata')
  return response.json() as Promise<AudioMetadata>
}

function formatMediaTime(time: number): string {
  if (!Number.isFinite(time) || time < 0) return '0:00'
  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function WorkspaceViewerPane(props: Props) {
  const queryClient = useQueryClient()
  const win = createMemo(() => props.workspace()?.windows.find((w) => w.id === props.windowId))

  const share = createMemo((): WorkspaceShareConfig | null => {
    const w = win()
    if (w?.source.kind === 'share' && w.source.token) {
      const panel = props.sharePanel()
      const fromWindow = (w.source.sharePath ?? '').trim()
      const fromPanel =
        panel && panel.token === w.source.token ? (panel.sharePath ?? '').trim() : ''
      return { token: w.source.token, sharePath: fromWindow || fromPanel }
    }
    return props.sharePanel() ?? null
  })

  const textViewerShareCtx = createMemo((): TextViewerShareContext | null => {
    const sh = share()
    if (!sh) return null
    return { token: sh.token, sharePath: sh.sharePath, isDirectory: true }
  })

  const viewingPath = createMemo(() => win()?.initialState?.viewing ?? '')
  const readerKind = createMemo(() => win()?.initialState?.readerKind ?? null)
  const currentTextTarget = createMemo(() => createTextDocumentTarget(viewingPath(), share()))
  const currentTextTargetKey = createMemo(() => textDocumentTargetKey(currentTextTarget()))

  const mediaType = createMemo(() => getMediaTypeFromPath(viewingPath()))

  const mediaUrl = createMemo(() => {
    const path = viewingPath()
    if (!path) return ''
    const sh = share()
    return sh ? buildShareMediaUrl(sh.token, sh.sharePath, path) : buildAdminMediaUrl(path)
  })

  const downloadHref = createMemo(() => {
    const path = viewingPath()
    if (!path) return '#'
    const sh = share()
    return fileDownloadHref(path, sh ? { token: sh.token, sharePath: sh.sharePath } : null)
  })

  const dirFromWindow = createMemo(() => win()?.initialState?.dir ?? '')

  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | undefined>()
  const [audioEl, setAudioEl] = createSignal<HTMLAudioElement | undefined>()
  const [mediaLoading, setMediaLoading] = createSignal(false)
  const [mediaError, setMediaError] = createSignal<string | null>(null)
  const [audioPlaying, setAudioPlaying] = createSignal(false)
  const [audioCurrentTime, setAudioCurrentTime] = createSignal(0)
  const [audioDuration, setAudioDuration] = createSignal(0)
  const [audioVolume, setAudioVolume] = createSignal(1)
  const [audioMuted, setAudioMuted] = createSignal(false)
  const [audioSurfaceEl, setAudioSurfaceEl] = createSignal<HTMLDivElement>()
  const [audioSurfaceSize, setAudioSurfaceSize] = createSignal({ width: 576, height: 256 })

  createEffect(() => {
    const element = audioSurfaceEl()
    if (!element) return
    const update = () => {
      const rect = element.getBoundingClientRect()
      setAudioSurfaceSize({ width: rect.width, height: rect.height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  })

  const audioLayout = createMemo<'compact' | 'standard' | 'expanded'>(() => {
    const size = audioSurfaceSize()
    if (size.width >= 640 && size.height >= 236) return 'expanded'
    if (size.width < 480 || size.height < 230) return 'compact'
    return 'standard'
  })

  const viewerShowVideoSurface = createMemo(
    () => mediaType() === MediaType.VIDEO && !!viewingPath(),
  )

  createEffect(() => {
    viewingPath()
    const type = mediaType()
    setMediaError(null)
    setMediaLoading(type === MediaType.VIDEO || type === MediaType.AUDIO)
    setAudioPlaying(false)
    setAudioCurrentTime(0)
    setAudioDuration(0)
  })

  createEffect(() => {
    const path = viewingPath()
    const url = mediaUrl()
    const vid = videoEl()
    if (!path || !viewerShowVideoSurface() || !vid || !url) return

    const abs = new URL(url, window.location.origin).href
    const srcMismatch = vid.src !== abs

    const ws = useWorkspaceAudio.getState()
    const storedTime = ws.playing === path ? ws.currentTime : 0
    const savedTime = useVideoPlaybackTime.getState().getSavedTime(path)
    const timeToRestore = storedTime > 0 ? storedTime : (savedTime ?? 0)

    let onCanPlay: () => void = () => {}

    if (srcMismatch) {
      onCanPlay = () => {
        vid.removeEventListener('canplay', onCanPlay)
        vid.removeEventListener('error', onCanPlay)
        if (timeToRestore > 0) {
          try {
            vid.currentTime = timeToRestore
          } catch {
            /* ignore */
          }
        }
        if (props.autoPlayVideo !== false) void vid.play().catch(() => {})
      }
      vid.addEventListener('canplay', onCanPlay)
      vid.src = url
      vid.load()
    } else if (timeToRestore > 0) {
      try {
        vid.currentTime = timeToRestore
      } catch {
        /* ignore */
      }
      if (props.autoPlayVideo !== false) void vid.play().catch(() => {})
    }

    onCleanup(() => {
      vid.removeEventListener('canplay', onCanPlay)
    })
  })

  function handleMediaError(element: HTMLMediaElement) {
    const code = element.error?.code
    setMediaLoading(false)
    setMediaError(code ? `Playback failed (media error ${code}).` : 'Playback failed.')
  }

  function retryMedia() {
    const element = mediaType() === MediaType.VIDEO ? videoEl() : audioEl()
    if (!element) return
    setMediaError(null)
    setMediaLoading(true)
    element.load()
    void element.play().catch(() => {})
  }

  function toggleAudioPlayback() {
    const element = audioEl()
    if (!element) return
    if (element.paused) void element.play().catch(() => {})
    else element.pause()
  }

  function seekAudio(time: number) {
    const element = audioEl()
    if (!element || !Number.isFinite(time)) return
    element.currentTime = time
    setAudioCurrentTime(time)
  }

  function setAudioPlayerVolume(volume: number) {
    const element = audioEl()
    const next = Math.max(0, Math.min(1, volume))
    setAudioVolume(next)
    setAudioMuted(next === 0)
    if (element) {
      element.volume = next
      element.muted = next === 0
    }
  }

  function toggleAudioMute() {
    const element = audioEl()
    const muted = !audioMuted()
    setAudioMuted(muted)
    if (element) element.muted = muted
  }

  createEffect(() => {
    const vis = props.contentVisible()
    const vid = videoEl()
    const path = viewingPath()
    if (mediaType() !== MediaType.VIDEO || !path || !vid || !viewerShowVideoSurface()) return
    if (!vis) {
      vid.pause()
    }
  })

  const listDirForFiles = createMemo(() => {
    const d = dirFromWindow()
    const sh = share()
    if (sh) return stripSharePrefix(d, sh.sharePath.replace(/\\/g, '/'))
    return d
  })

  const filesQuery = useQuery(() => {
    const sh = share()
    return {
      queryKey: sh
        ? queryKeys.shareFiles(sh.token, listDirForFiles())
        : queryKeys.files(listDirForFiles()),
      queryFn: () =>
        sh
          ? api<{ files: FileItem[] }>(
              `/api/share/${sh.token}/files?dir=${encodeURIComponent(listDirForFiles())}`,
            )
          : api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(listDirForFiles())}`),
      enabled:
        (mediaType() === MediaType.IMAGE || mediaType() === MediaType.AUDIO) &&
        Boolean(viewingPath()),
    }
  })

  const imageFiles = createMemo(() =>
    (filesQuery.data?.files ?? []).filter((f) => f.type === MediaType.IMAGE),
  )
  const folderAudioFiles = createMemo(() =>
    (filesQuery.data?.files ?? []).filter((file) => file.type === MediaType.AUDIO),
  )

  const audioMetadataUrl = createMemo(() => {
    const path = viewingPath()
    if (!path || mediaType() !== MediaType.AUDIO) return ''
    return buildAudioMetadataUrl(path, share())
  })

  const audioMetadataQuery = useQuery(() => ({
    queryKey: queryKeys.audioMetadata(viewingPath()),
    queryFn: () => fetchAudioMetadata(audioMetadataUrl()),
    enabled: !!audioMetadataUrl(),
    refetchOnWindowFocus: false,
  }))

  const playlistMetadataQueries = useQueries(() => ({
    queries: folderAudioFiles().map((file) => {
      const url = buildAudioMetadataUrl(file.path, share())
      return {
        queryKey: queryKeys.audioMetadata(file.path),
        queryFn: () => fetchAudioMetadata(url),
        enabled: mediaType() === MediaType.AUDIO && audioLayout() === 'expanded',
        refetchOnWindowFocus: false,
      }
    }),
  }))

  const folderCoverUrl = createMemo(() => {
    const cover = (filesQuery.data?.files ?? []).find((file) => {
      if (file.type !== MediaType.IMAGE) return false
      const stem = file.name.toLowerCase().replace(/\.[^.]+$/, '')
      return stem === 'cover' || stem === 'folder'
    })
    if (!cover) return null
    const sh = share()
    return sh
      ? buildShareMediaUrl(sh.token, sh.sharePath, cover.path)
      : buildAdminMediaUrl(cover.path)
  })

  const audioArtworkUrl = createMemo(() => audioMetadataQuery.data?.coverArt || folderCoverUrl())

  const audioDisplayDuration = createMemo(() => {
    const elementDuration = audioDuration()
    if (elementDuration > 0) return elementDuration
    return audioMetadataQuery.data?.duration ?? 0
  })

  const [zoom, setZoom] = createSignal<number | 'fit'>('fit')
  const [rotation, setRotation] = createSignal(0)
  const [imageSurface, setImageSurface] = createSignal<HTMLDivElement>()
  let imageWheelDelta = 0
  let imageWheelResetTimer: ReturnType<typeof setTimeout> | undefined
  let imageWheelFlushTimer: ReturnType<typeof setTimeout> | undefined
  let pendingImageWheelSteps = 0

  const fileName = createMemo(() => viewingPath().split(/[/\\]/).pop() ?? 'file')

  const currentImageIndex = createMemo(() =>
    imageFiles().findIndex((f) => f.path === viewingPath()),
  )
  const currentImageNumber = createMemo(() =>
    currentImageIndex() !== -1 ? currentImageIndex() + 1 : 1,
  )
  const totalImages = createMemo(() => imageFiles().length)
  const imagePrefetchPaths = createMemo(() => {
    const index = currentImageIndex()
    return index < 0
      ? []
      : imageFiles()
          .slice(index + 1, index + 3)
          .map((file) => file.path)
  })
  const responsiveImage = createResponsiveImage({
    path: viewingPath,
    context: share,
    viewport: imageSurface,
    zoom,
    prefetchPaths: imagePrefetchPaths,
    onDisplayPath: () => {
      setZoom('fit')
      setRotation(0)
    },
  })

  function moveImage(offset: number) {
    const list = imageFiles()
    const vp = viewingPath()
    if (!vp || list.length === 0) return
    const i = list.findIndex((f) => f.path === vp)
    if (i === -1) return
    const target = Math.max(0, Math.min(list.length - 1, i + offset))
    if (target === i) return
    props.onUpdateViewing(props.windowId, list[target].path)
  }

  function goNextImage() {
    moveImage(1)
  }

  function goPrevImage() {
    moveImage(-1)
  }

  function handleImageWheel(e: WheelEvent) {
    if (e.ctrlKey || !window.matchMedia('(pointer: fine)').matches) return
    e.preventDefault()

    const multiplier =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1
    imageWheelDelta += e.deltaY * multiplier
    clearTimeout(imageWheelResetTimer)
    imageWheelResetTimer = setTimeout(() => {
      imageWheelDelta = 0
    }, 150)

    if (Math.abs(imageWheelDelta) < 40) return
    pendingImageWheelSteps += imageWheelDelta > 0 ? 1 : -1
    imageWheelDelta = 0
    flushImageWheelSteps()
  }

  function flushImageWheelSteps() {
    if (imageWheelFlushTimer || pendingImageWheelSteps === 0) return
    const steps = pendingImageWheelSteps
    pendingImageWheelSteps = 0
    moveImage(steps)
    imageWheelFlushTimer = setTimeout(() => {
      imageWheelFlushTimer = undefined
      flushImageWheelSteps()
    }, 100)
  }

  onCleanup(() => {
    clearTimeout(imageWheelResetTimer)
    clearTimeout(imageWheelFlushTimer)
  })

  createEffect(() => {
    if (mediaType() !== MediaType.IMAGE || !viewingPath()) return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') != null) {
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrevImage()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNextImage()
      }
    }
    window.addEventListener('keydown', handler)
    onCleanup(() => window.removeEventListener('keydown', handler))
  })

  const imgStyle = createMemo((): JSX.CSSProperties => {
    const z = zoom()
    const quarterTurn = rotation() % 180 !== 0
    const { width, height } = responsiveImage.dimensions()
    const base: JSX.CSSProperties =
      z === 'fit'
        ? {
            width: quarterTurn && height > 0 ? `${height}px` : '100%',
            height: quarterTurn && width > 0 ? `${width}px` : '100%',
            'object-fit': 'contain',
          }
        : {
            'max-width': '100%',
            'max-height': '100%',
            width: 'auto',
            height: 'auto',
            'object-fit': 'none',
          }
    const scale = z === 'fit' ? 1 : z / 100
    return {
      ...base,
      transform: `scale(${scale}) rotate(${rotation()}deg)`,
    }
  })

  const textQueryKey = createMemo(() => {
    const target = currentTextTarget()
    return target.kind === 'share'
      ? queryKeys.shareText(target.token, target.sharePath, target.viewingPath)
      : queryKeys.textContent(target.viewingPath)
  })

  const textQuery = useQuery(() => ({
    queryKey: textQueryKey(),
    enabled: mediaType() === MediaType.TEXT && Boolean(viewingPath()),
    queryFn: async () => {
      const url = mediaUrl()
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load file')
      return await res.text()
    },
  }))

  const ext = createMemo(() => viewingPath().split('.').pop()?.toLowerCase() || '')
  const isMarkdown = createMemo(() => ext() === 'md')

  const fileEditable = createMemo(() => {
    if (textViewerShareCtx()) return props.shareCanEdit
    return isPathEditable(viewingPath(), props.editableFolders)
  })

  const [readOnlyView, setReadOnlyView] = createSignal(false)
  const [editContent, setEditContent] = createSignal('')
  const [editorBaseContent, setEditorBaseContent] = createSignal('')
  const [savedContentAwaitingQuery, setSavedContentAwaitingQuery] = createSignal<string | null>(
    null,
  )
  const [copied, setCopied] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)

  let lastTextDocumentKey = ''
  let hydratedTextDocumentKey = ''
  createEffect(() => {
    const target = currentTextTarget()
    const documentKey = textDocumentTargetKey(target)
    if (mediaType() !== MediaType.TEXT || !target.viewingPath) return
    if (documentKey !== lastTextDocumentKey) {
      lastTextDocumentKey = documentKey
      hydratedTextDocumentKey = ''
      setSavedContentAwaitingQuery(null)
      setReadOnlyView(false)
      setEditContent('')
      setEditorBaseContent('')
      setCopied(false)
      setSaveError(null)
    }

    void textQuery.data
    const data = queryClient.getQueryData<string>(textQueryKey())
    if (data === undefined) return
    if (documentKey !== hydratedTextDocumentKey) {
      hydratedTextDocumentKey = documentKey
      const draft = readTextEditorDraft(
        textEditorDraftKey(textDocumentDraftScope(target), target.viewingPath),
      )
      setEditContent(draft?.content !== data ? (draft?.content ?? data) : data)
      setEditorBaseContent(data)
    } else {
      const savedContent = savedContentAwaitingQuery()
      if (savedContent !== null && data === savedContent) {
        setEditorBaseContent(savedContent)
        setSavedContentAwaitingQuery(null)
      } else if (data !== editorBaseContent() && editContent() === editorBaseContent()) {
        setEditContent(data)
        setEditorBaseContent(data)
      }
    }
  })

  const showEditor = createMemo(() => fileEditable() && !readOnlyView())

  const isCurrentSaveTarget = (variables: WorkspaceTextSaveVariables) =>
    textDocumentTargetKey(variables.target) === currentTextTargetKey()

  const textSaveVariables = (): WorkspaceTextSaveVariables => {
    return {
      content: editContent(),
      target: currentTextTarget(),
      queryKey: textQueryKey(),
    }
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (variables: WorkspaceTextSaveVariables) => {
      return enqueueTextDocumentSave(variables.target, async () => {
        const { content, target } = variables
        if (target.kind === 'share') {
          const rel = shareEditRelativePath(target.viewingPath, target.sharePath)
          await post(`/api/share/${target.token}/edit`, { path: rel, content })
        } else {
          await post('/api/files/edit', { path: target.viewingPath, content })
        }
        return content
      })
    },
    onSuccess: (content: string, variables) => {
      if (isCurrentSaveTarget(variables)) setSavedContentAwaitingQuery(content)
      queryClient.setQueryData(variables.queryKey, content)
      void queryClient.invalidateQueries({ queryKey: variables.queryKey })
    },
  }))

  async function saveText(quiet: boolean) {
    if (editContent() === editorBaseContent()) return
    const variables = textSaveVariables()
    try {
      await saveMutation.mutateAsync(variables)
      if (isCurrentSaveTarget(variables)) setSaveError(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to save file'
      if (isCurrentSaveTarget(variables)) setSaveError(message)
      if (!quiet && isCurrentSaveTarget(variables)) window.alert(message)
    }
  }

  const draftKey = createMemo(() => {
    const target = currentTextTarget()
    return textEditorDraftKey(textDocumentDraftScope(target), target.viewingPath)
  })
  const textDirty = createMemo(() => editContent() !== editorBaseContent())
  const textConflict = createMemo(
    () => textDirty() && textQuery.data !== undefined && textQuery.data !== editorBaseContent(),
  )

  function reloadRemoteText() {
    const remote = textQuery.data ?? ''
    setEditContent(remote)
    setEditorBaseContent(remote)
  }

  createEffect(() => {
    if (hydratedTextDocumentKey !== currentTextTargetKey()) return
    if (textDirty()) writeTextEditorDraft(draftKey(), editContent())
    else removeTextEditorDraft(draftKey())
  })

  createEffect(() => {
    const warnIfDirty = (event: BeforeUnloadEvent) => {
      if (!textDirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnIfDirty)
    onCleanup(() => window.removeEventListener('beforeunload', warnIfDirty))
  })

  let autosaveTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    onCleanup(() => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
    })
    if (hydratedTextDocumentKey !== currentTextTargetKey()) return
    if (!fileEditable() || readOnlyView() || textConflict()) return
    if (editContent() === (textQuery.data ?? '')) return
    autosaveTimer = setTimeout(() => {
      void saveText(true)
    }, 2000)
  })

  async function handleCopy() {
    const src = fileEditable() ? editContent() : (textQuery.data ?? '')
    if (!src) return
    try {
      await navigator.clipboard.writeText(src)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  function handleImageDownload() {
    const link = document.createElement('a')
    link.href = downloadHref()
    link.download = fileName()
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const lineCount = createMemo(() => {
    const t = textQuery.data ?? ''
    return t ? t.split('\n').length : 0
  })

  const kbList = createMemo(() => props.knowledgeBases ?? [])
  const resolveImageUrl = createMemo(() =>
    buildResolveMarkdownImageUrl(viewingPath(), textViewerShareCtx(), kbList()),
  )

  function AudioArtwork(props: { class: string }) {
    return (
      <div
        class={`ring-border/70 relative shrink-0 overflow-hidden rounded-lg bg-neutral-900 shadow-md ring-1 ${props.class}`}
      >
        <Show
          when={audioArtworkUrl()}
          fallback={
            <div class='flex h-full w-full items-center justify-center bg-gradient-to-br from-fuchsia-950 to-neutral-950'>
              <Music2 class='h-8 w-8 text-fuchsia-300/80' stroke-width={1.5} />
            </div>
          }
        >
          <img src={audioArtworkUrl()!} alt='Album art' class='h-full w-full object-cover' />
        </Show>
      </div>
    )
  }

  function AudioInfo(props: { compact?: boolean }) {
    return (
      <div class='min-w-0'>
        <h2
          class={`truncate font-semibold leading-tight text-foreground ${props.compact ? 'text-sm' : 'text-lg'}`}
          title={audioMetadataQuery.data?.title || fileName()}
        >
          {audioMetadataQuery.data?.title || fileName()}
        </h2>
        <p class='mt-0.5 truncate text-xs text-muted-foreground'>
          {audioMetadataQuery.data?.artist || 'Unknown artist'}
        </p>
        <Show when={!props.compact}>
          <p class='truncate text-[11px] text-muted-foreground/75'>
            {audioMetadataQuery.data?.album || dirFromWindow() || 'Unknown album'}
          </p>
          <div class='mt-1.5 flex gap-1.5 text-[10px] text-muted-foreground'>
            <span class='rounded bg-muted px-1.5 py-0.5 font-medium'>{ext().toUpperCase()}</span>
            <span class='rounded bg-muted px-1.5 py-0.5 tabular-nums'>
              {formatMediaTime(audioDisplayDuration())}
            </span>
          </div>
        </Show>
      </div>
    )
  }

  function AudioSeek() {
    return (
      <div class='flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground'>
        <span class='w-8 text-right tabular-nums'>{formatMediaTime(audioCurrentTime())}</span>
        <input
          type='range'
          aria-label='Playback position'
          min={0}
          max={audioDisplayDuration() || 0}
          step={0.1}
          value={audioCurrentTime()}
          onInput={(event) => seekAudio(Number.parseFloat(event.currentTarget.value))}
          class='[&::-webkit-slider-thumb]:bg-primary h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
        />
        <span class='w-8 tabular-nums'>{formatMediaTime(audioDisplayDuration())}</span>
      </div>
    )
  }

  function AudioTransport() {
    return (
      <div class='flex min-w-0 items-center gap-2'>
        <button
          type='button'
          aria-label={audioPlaying() ? 'Pause' : 'Play'}
          class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex size-9 shrink-0 items-center justify-center rounded-full shadow-sm'
          onClick={toggleAudioPlayback}
        >
          <Show when={audioPlaying()} fallback={<Play class='size-4' fill='currentColor' />}>
            <Pause class='size-4' fill='currentColor' />
          </Show>
        </button>
        <button
          type='button'
          aria-label={audioMuted() ? 'Unmute' : 'Mute'}
          class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
          onClick={toggleAudioMute}
        >
          <Show when={audioMuted()} fallback={<Volume2 class='size-4' />}>
            <VolumeX class='size-4' />
          </Show>
        </button>
        <input
          type='range'
          aria-label='Volume'
          min={0}
          max={1}
          step={0.01}
          value={audioMuted() ? 0 : audioVolume()}
          onInput={(event) => setAudioPlayerVolume(Number.parseFloat(event.currentTarget.value))}
          class='[&::-webkit-slider-thumb]:bg-foreground h-1.5 min-w-10 flex-1 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
        />
        <a
          href={downloadHref()}
          download={fileName()}
          aria-label='Download'
          title='Download'
          class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
        >
          <Download class='size-4' />
        </a>
      </div>
    )
  }

  function StandardAudioPlayer() {
    return (
      <div class='grid h-full min-h-0 grid-cols-[112px_minmax(0,1fr)] items-center gap-4 p-4'>
        <AudioArtwork class='size-28' />
        <div class='min-w-0 space-y-2.5'>
          <AudioInfo />
          <AudioSeek />
          <AudioTransport />
        </div>
      </div>
    )
  }

  function CompactAudioPlayer() {
    return (
      <div class='flex h-full min-h-0 flex-col justify-center gap-2.5 p-3'>
        <div class='flex min-w-0 items-center gap-3'>
          <AudioArtwork class='size-12' />
          <div class='min-w-0 flex-1'>
            <AudioInfo compact />
          </div>
        </div>
        <AudioSeek />
        <AudioTransport />
      </div>
    )
  }

  function AudioPlaylist() {
    return (
      <div
        data-testid='canvas-audio-playlist'
        class='flex h-full min-h-0 flex-col border-l border-border bg-muted/20'
      >
        <div class='border-b border-border px-3 py-2.5'>
          <p class='truncate text-[11px] text-muted-foreground'>{dirFromWindow()}</p>
        </div>
        <div class='min-h-0 flex-1 overflow-auto p-1.5'>
          <For each={folderAudioFiles()}>
            {(file, index) => {
              const active = () => file.path === viewingPath()
              const label = () => {
                const metadata = playlistMetadataQueries[index()]?.data as AudioMetadata | undefined
                const title = metadata?.title?.trim() || file.name
                const artist = metadata?.artist?.trim()
                return artist ? `${artist} — ${title}` : title
              }
              return (
                <button
                  type='button'
                  data-audio-playlist-path={file.path}
                  class='flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted'
                  classList={{ 'bg-primary/10 text-primary': active() }}
                  onClick={() => props.onUpdateViewing(props.windowId, file.path)}
                >
                  <Music2 class='size-3.5 shrink-0' />
                  <span class='min-w-0 flex-1 truncate text-xs' title={label()}>
                    {label()}
                  </span>
                </button>
              )
            }}
          </For>
        </div>
      </div>
    )
  }

  return (
    <div
      data-no-window-drag
      class='absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background'
    >
      <Show when={readerKind() && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <ReaderDialog
              sourcePath={sourcePath}
              sourceKind={readerKind()!}
              shareContext={share()}
              embedded
              showClose={false}
            />
          </div>
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.IMAGE && viewingPath()}>
        <div class='flex h-full min-h-0 flex-col bg-black'>
          <div class='flex h-8 shrink-0 items-center justify-between border-b border-white/10 bg-black/50 px-2'>
            <Show when={totalImages() > 0}>
              <span class='text-xs text-white/90'>
                {currentImageNumber()} of {totalImages()}
              </span>
            </Show>
            <div class='flex flex-1 items-center justify-end gap-1'>
              <button
                type='button'
                class='inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                onClick={() => {
                  setZoom((prev) => {
                    const cur = prev === 'fit' ? 100 : prev
                    return Math.max(cur - 25, 25)
                  })
                }}
              >
                <ZoomOut class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <span class='min-w-12 text-center text-xs text-white/80'>
                {zoom() === 'fit' ? 'Fit' : `${zoom()}%`}
              </span>
              <button
                type='button'
                class='inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                onClick={() => {
                  setZoom((prev) => {
                    const cur = prev === 'fit' ? 100 : prev
                    return Math.min(cur + 25, 400)
                  })
                }}
              >
                <ZoomIn class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <button
                type='button'
                title='Fit to screen'
                class='inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                onClick={() => {
                  setZoom('fit')
                  setRotation(0)
                }}
              >
                <Maximize2 class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <button
                type='button'
                class='inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                onClick={() => setRotation((r) => (r + 90) % 360)}
              >
                <RotateCw class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <button
                type='button'
                class='inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                onClick={handleImageDownload}
              >
                <Download class='h-3.5 w-3.5' stroke-width={2} />
              </button>
            </div>
          </div>
          <div
            data-testid='workspace-image-surface'
            class='relative flex min-h-0 flex-1 items-center justify-center p-2'
            classList={{ 'overflow-hidden': zoom() === 'fit', 'overflow-auto': zoom() !== 'fit' }}
            ref={setImageSurface}
            onWheel={handleImageWheel}
          >
            <button
              type='button'
              class='absolute top-0 bottom-0 left-0 z-10 w-[30%] cursor-pointer'
              onClick={goPrevImage}
              aria-label='Previous image'
            />
            <button
              type='button'
              class='absolute top-0 right-0 bottom-0 z-10 w-[30%] cursor-pointer'
              onClick={goNextImage}
              aria-label='Next image'
            />
            <Show when={responsiveImage.showSpinner()}>
              <LoaderCircle
                class='absolute top-1/2 left-1/2 z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/80'
                aria-label='Loading image'
              />
            </Show>
            <Show when={responsiveImage.error()}>
              <div class='z-20 flex flex-col items-center gap-2 text-sm text-white'>
                <p>Could not load image</p>
                <button
                  type='button'
                  class='rounded-md border border-white/30 px-2.5 py-1 hover:bg-white/10'
                  onClick={responsiveImage.retry}
                >
                  Retry
                </button>
              </div>
            </Show>
            <Show when={responsiveImage.src() && !responsiveImage.error()}>
              <img
                src={responsiveImage.src()}
                alt={fileName()}
                class='pointer-events-none shrink-0'
                classList={{ invisible: responsiveImage.showSpinner() }}
                style={imgStyle()}
              />
            </Show>
          </div>
        </div>
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.PDF && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <ReaderDialog
              sourcePath={sourcePath}
              sourceKind='pdf'
              shareContext={share()}
              embedded
              showClose={false}
            />
          </div>
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.BOOK && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <ReaderDialog
              sourcePath={sourcePath}
              sourceKind='book'
              shareContext={share()}
              embedded
              showClose={false}
            />
          </div>
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.VIDEO && viewingPath()}>
        <div class='flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-black'>
          <div class='group relative flex min-h-0 min-w-0 flex-1 flex-col bg-black'>
            <Show when={props.showListenOnly !== false}>
              <div class='absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100'>
                <button
                  type='button'
                  title='Listen only'
                  class='bg-secondary inline-flex h-7 w-7 items-center justify-center rounded-md'
                  onClick={() => {
                    const handoff = props.onListenOnlyHandoff
                    const vid = videoEl()
                    const path = viewingPath()
                    if (!path) return
                    if (handoff) {
                      handoff({
                        path,
                        dir: dirFromWindow() || undefined,
                        videoCurrentTime: vid?.currentTime ?? 0,
                      })
                      return
                    }
                    const key = props.storageKey
                    if (vid) useWorkspaceAudio.getState().setCurrentTime(vid.currentTime)
                    if (key) {
                      useWorkspaceAudio.getState().armUserGestureTransport(path)
                      useWorkspaceAudio.getState().playAudio(path, dirFromWindow() || undefined)
                      useWorkspaceAudio.getState().setAudioOnly(key, true)
                    }
                    props.onListenOnlyDismissViewer?.()
                  }}
                >
                  <Headphones class='h-4 w-4' stroke-width={2} />
                </button>
              </div>
            </Show>
            <Show when={mediaLoading() && !mediaError()}>
              <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45 text-white'>
                <LoaderCircle class='h-7 w-7 animate-spin' stroke-width={2} />
              </div>
            </Show>
            <Show when={mediaError()}>
              <div class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center text-white'>
                <p class='text-sm'>{mediaError()}</p>
                <div class='flex gap-2'>
                  <button
                    type='button'
                    class='rounded-md bg-white px-3 py-1.5 text-sm text-black'
                    onClick={retryMedia}
                  >
                    Retry
                  </button>
                  <a
                    href={downloadHref()}
                    download={fileName()}
                    class='rounded-md border border-white/40 px-3 py-1.5 text-sm'
                  >
                    Download
                  </a>
                </div>
              </div>
            </Show>
            <video
              ref={(el) => setVideoEl(el ?? undefined)}
              class='min-h-0 w-full flex-1 bg-black object-contain'
              controls
              playsinline
              data-media-type={MediaType.VIDEO}
              title={fileName()}
              onLoadStart={() => setMediaLoading(true)}
              onCanPlay={() => setMediaLoading(false)}
              onError={(event) => handleMediaError(event.currentTarget)}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth > 0 && v.videoHeight > 0) {
                  props.onVideoMetadataLoaded?.(v.videoWidth, v.videoHeight)
                }
              }}
            />
          </div>
        </div>
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.AUDIO && viewingPath()}>
        <div
          ref={setAudioSurfaceEl}
          data-testid='canvas-audio-player-ui'
          data-audio-layout={audioLayout()}
          class='relative h-full min-h-0 overflow-hidden bg-gradient-to-br from-muted/45 via-background to-background'
        >
          <audio
            ref={(element) => setAudioEl(element)}
            src={mediaUrl()}
            preload='auto'
            class='hidden'
            title={fileName()}
            data-canvas-audio-player={props.windowId}
            onLoadStart={() => setMediaLoading(true)}
            onCanPlay={() => setMediaLoading(false)}
            onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration || 0)}
            onDurationChange={(event) => setAudioDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setAudioCurrentTime(event.currentTarget.currentTime)}
            onPlay={(event) => {
              setAudioPlaying(true)
              props.onAudioPlay?.(event.currentTarget)
            }}
            onPause={(event) => {
              setAudioPlaying(false)
              props.onAudioPause?.(event.currentTarget)
            }}
            onEnded={(event) => {
              setAudioPlaying(false)
              props.onAudioPause?.(event.currentTarget)
            }}
            onError={(event) => handleMediaError(event.currentTarget)}
          />

          <Show when={mediaLoading() && !mediaError()}>
            <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/55 backdrop-blur-sm'>
              <LoaderCircle class='h-7 w-7 animate-spin text-muted-foreground' stroke-width={2} />
            </div>
          </Show>
          <Show when={mediaError()}>
            <div class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center'>
              <p class='text-destructive text-sm'>{mediaError()}</p>
              <div class='flex gap-2'>
                <button
                  type='button'
                  class='rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                  onClick={retryMedia}
                >
                  Retry
                </button>
                <a
                  href={downloadHref()}
                  download={fileName()}
                  class='rounded-md border border-input px-3 py-1.5 text-sm'
                >
                  Download
                </a>
              </div>
            </div>
          </Show>

          <Switch>
            <Match when={audioLayout() === 'compact'}>
              <CompactAudioPlayer />
            </Match>
            <Match when={audioLayout() === 'expanded'}>
              <div class='grid h-full min-h-0 grid-cols-[minmax(0,1fr)_272px]'>
                <StandardAudioPlayer />
                <AudioPlaylist />
              </div>
            </Match>
            <Match when={audioLayout() === 'standard'}>
              <StandardAudioPlayer />
            </Match>
          </Switch>
        </div>
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.TEXT && viewingPath()}>
        <div class='flex h-full min-h-0 flex-col'>
          <div class='flex h-9 shrink-0 flex-wrap items-center gap-1 border-b border-border bg-muted/50 px-2'>
            <span class='text-muted-foreground flex items-center gap-1 text-xs'>
              {ext().toUpperCase()}
              <Show when={lineCount() > 0}>
                <> &middot; {lineCount()} lines</>
              </Show>
            </span>
            <div class='ml-auto flex items-center gap-0.5'>
              <Show when={showEditor()}>
                <Show when={saveError()}>
                  <button
                    type='button'
                    class='text-destructive inline-flex items-center gap-1 px-1 text-xs hover:underline'
                    title={saveError() ?? ''}
                    onClick={() => void saveText(true)}
                  >
                    <AlertCircle class='h-3.5 w-3.5' stroke-width={2} />
                    Save failed — retry
                  </button>
                </Show>
                <button
                  type='button'
                  class='hover:bg-muted rounded-md px-2 py-1 text-xs'
                  onClick={() => setReadOnlyView(true)}
                >
                  Read only
                </button>
              </Show>
              <Show when={!showEditor()}>
                <Show when={fileEditable()}>
                  <button
                    type='button'
                    class='bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-2 py-1 text-xs'
                    onClick={() => {
                      setReadOnlyView(false)
                    }}
                  >
                    Edit
                  </button>
                </Show>
                <button
                  type='button'
                  title='Copy to clipboard'
                  class='hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md text-sm'
                  onClick={() => void handleCopy()}
                >
                  {copied() ? '✓' : '⎘'}
                </button>
              </Show>
              <button
                type='button'
                title='Download'
                class='hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md'
                onClick={() => {
                  const link = document.createElement('a')
                  link.href = downloadHref()
                  link.download = fileName()
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                }}
              >
                <Download class='h-3.5 w-3.5' stroke-width={2} />
              </button>
            </div>
          </div>
          <div class='min-h-0 flex-1 overflow-hidden'>
            <Show when={textConflict()}>
              <div class='flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200'>
                <span>This file changed elsewhere. Your unsaved edits were kept.</span>
                <button type='button' class='shrink-0 underline' onClick={reloadRemoteText}>
                  Reload remote version
                </button>
              </div>
            </Show>
            <Show when={textQuery.isPending}>
              <p class='text-muted-foreground p-3 text-sm'>Loading…</p>
            </Show>
            <Show when={textQuery.isError}>
              <p class='text-destructive p-3 text-sm'>Failed to load file.</p>
            </Show>
            <Show when={!textQuery.isPending && !textQuery.isError}>
              <Show
                when={isMarkdown()}
                fallback={
                  <Show
                    when={showEditor()}
                    fallback={
                      <div class='scrollbar-thin h-full overflow-auto'>
                        <pre class='text-foreground wrap-break-word whitespace-pre-wrap px-3 py-2 font-sans text-base leading-[1.75]'>
                          {textQuery.data ?? ''}
                        </pre>
                      </div>
                    }
                  >
                    <div class='h-full'>
                      <textarea
                        class='scrollbar-thin h-full w-full resize-none bg-transparent px-3 py-2 font-sans text-base leading-[1.75] text-foreground wrap-break-word whitespace-pre-wrap focus:outline-none'
                        value={editContent()}
                        spellcheck={false}
                        onInput={(e) => setEditContent(e.currentTarget.value)}
                        onBlur={() => {
                          if (!textConflict()) void saveText(true)
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === 'ArrowLeft' ||
                            e.key === 'ArrowRight' ||
                            e.key === 'ArrowUp' ||
                            e.key === 'ArrowDown' ||
                            e.key === 'Home' ||
                            e.key === 'End' ||
                            e.key === 'PageUp' ||
                            e.key === 'PageDown'
                          ) {
                            e.stopPropagation()
                          }
                        }}
                      />
                    </div>
                  </Show>
                }
              >
                <Show keyed when={currentTextTargetKey()}>
                  {(_documentKey) => (
                    <LazyMarkdownDocument
                      content={fileEditable() ? editContent() : (textQuery.data ?? '')}
                      mode={showEditor() ? 'edit' : 'read'}
                      onChange={setEditContent}
                      onBlur={() => {
                        if (fileEditable() && !textConflict()) void saveText(true)
                      }}
                      onSave={() => saveText(false)}
                      resolveImageUrl={resolveImageUrl()}
                      onPasteImage={(event, _selection, complete) => {
                        const pasteTargetKey = currentTextTargetKey()
                        return tryPasteKnowledgeBaseImage(event, {
                          viewingPath: viewingPath(),
                          knowledgeBases: kbList(),
                          editableFolders: props.editableFolders,
                          shareContext: textViewerShareCtx(),
                          shareCanEdit: props.shareCanEdit,
                          shareCanUpload: props.shareCanUpload,
                          completeCodeMirrorPaste: (markdown) =>
                            completeMarkdownImagePaste(
                              markdown,
                              complete,
                              () =>
                                pasteTargetKey === currentTextTargetKey() &&
                                hydratedTextDocumentKey === pasteTargetKey &&
                                fileEditable() &&
                                readOnlyView() &&
                                !textConflict(),
                              () => void saveText(true),
                            ),
                        })
                      }}
                      ariaLabel={`${fileName()} Markdown ${showEditor() ? 'editor' : 'document'}`}
                    />
                  )}
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.OTHER && viewingPath()}>
        <div class='flex flex-1 flex-col items-center justify-center gap-4 p-6'>
          <p class='text-muted-foreground text-center text-sm'>
            This file type cannot be previewed.
          </p>
          <a
            href={downloadHref()}
            download={fileName()}
            class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
          >
            Download File
          </a>
        </div>
      </Show>
    </div>
  )
}
