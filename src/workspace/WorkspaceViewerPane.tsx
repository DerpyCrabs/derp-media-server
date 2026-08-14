import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/solid-query'
import { apiEndpoints } from '@/lib/api-endpoints'
import {
  createTextDocumentTarget,
  enqueueTextDocumentSave,
  textDocumentDraftScope,
  textDocumentTargetKey,
  type TextDocumentTarget,
} from '@/lib/text-document-target'
import { queryKeys } from '@/lib/query-keys'
import { filesQueryOptions, invalidateFileQueries } from '@/lib/query-options'
import { fileDownloadHref } from '@/lib/download-urls'
import { getMediaType, getMediaTypeFromPath } from '@/lib/media-utils'
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
import { buildAdminMediaUrl, buildAudioMetadataUrl } from '../lib/build-media-url'
import { createResponsiveImage } from '../lib/responsive-image'
import { LazyMarkdownDocument } from '../media/LazyMarkdownDocument'
import { completeMarkdownImagePaste } from '../media/markdown/paste-completion'
import {
  audioPlaybackQueueFromFiles,
  createFilesystemPlaybackItem,
  playbackItemKey,
  type PlaybackItem,
  type PlaybackMedia,
} from '../features/playback'
import {
  usePlaybackMediaHost,
  usePlaybackSession,
  usePlaybackSnapshot,
} from '../features/playback/PlaybackProvider'

const ReaderDialog = lazy(() =>
  import('../reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
)

type Props = {
  windowId: string
  contentVisible: Accessor<boolean>
  workspace: Accessor<PersistedWorkspaceState | null>
  editableFolders: string[]
  /** Same as main file browser — required for Obsidian-style images in knowledge bases. */
  knowledgeBases?: string[]
  onUpdateViewing: (windowId: string, path: string) => void
  onVideoMetadataLoaded?: (videoWidth: number, videoHeight: number) => void
  autoPlayVideo?: boolean
  /** Close the viewer tab after switching to taskbar audio (playback keeps running). */
  onListenOnlyDismissViewer?: () => void
  showListenOnly?: boolean
  onAudioActivate?: () => void
}

type WorkspaceTextSaveQueryKey = ReturnType<typeof queryKeys.textContent>

type WorkspaceTextSaveVariables = {
  content: string
  target: TextDocumentTarget
  queryKey: WorkspaceTextSaveQueryKey
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

function normalizedPlaybackPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function playbackPathMatches(item: PlaybackItem | null, path: string): boolean {
  return !!item && normalizedPlaybackPath(item.locator) === normalizedPlaybackPath(path)
}

function playbackItemForPath(path: string, media: PlaybackMedia): PlaybackItem {
  return createFilesystemPlaybackItem({
    locator: path,
    name: path.split(/[/\\]/).pop() ?? path,
    media,
  })
}

export function WorkspaceViewerPane(props: Props) {
  const queryClient = useQueryClient()
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()
  const playbackMediaHost = usePlaybackMediaHost()
  const win = createMemo(() => props.workspace()?.windows.find((w) => w.id === props.windowId))
  let paneEl: HTMLDivElement | undefined

  const viewingPath = createMemo(() => win()?.initialState?.viewing ?? '')
  const readerKind = createMemo(() => win()?.initialState?.readerKind ?? null)
  const currentTextTarget = createMemo(() => createTextDocumentTarget(viewingPath()))
  const currentTextTargetKey = createMemo(() => textDocumentTargetKey(currentTextTarget()))

  const mediaType = createMemo(() => getMediaTypeFromPath(viewingPath()))

  const mediaUrl = createMemo(() => {
    const path = viewingPath()
    if (!path) return ''
    return buildAdminMediaUrl(path)
  })

  const downloadHref = createMemo(() => {
    const path = viewingPath()
    if (!path) return '#'
    return fileDownloadHref(path)
  })

  const dirFromWindow = createMemo(() => win()?.initialState?.dir ?? '')

  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | undefined>()
  const [videoReadyGeneration, setVideoReadyGeneration] = createSignal(0)
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

  const videoPlaybackActive = createMemo(() => {
    const state = playback()
    return (
      mediaType() === MediaType.VIDEO &&
      state.mode === 'video' &&
      state.currentItem?.media === 'video' &&
      playbackPathMatches(state.currentItem, viewingPath())
    )
  })
  const videoLoading = createMemo(() => {
    if (!videoPlaybackActive()) return false
    const state = playback()
    if (state.phase === 'resolving') return true
    return !!state.source && videoReadyGeneration() !== state.source.generation
  })
  const videoError = createMemo(() => (videoPlaybackActive() ? playback().error : null))

  let offeredInitialVideoPath = ''
  createEffect(() => {
    const path = viewingPath()
    if (
      !path ||
      mediaType() !== MediaType.VIDEO ||
      !props.contentVisible() ||
      offeredInitialVideoPath === normalizedPlaybackPath(path)
    ) {
      return
    }
    offeredInitialVideoPath = normalizedPlaybackPath(path)
    const currentItem = playback().currentItem
    if (playbackPathMatches(currentItem, path) || (currentItem && props.autoPlayVideo === false)) {
      return
    }
    playbackSession.dispatch({
      type: 'load',
      item: playbackItemForPath(path, 'video'),
      autoplay: props.autoPlayVideo !== false,
      mode: 'video',
    })
  })

  createEffect(() => {
    const generation = videoPlaybackActive() ? (playback().source?.generation ?? 0) : 0
    if (videoReadyGeneration() !== generation) setVideoReadyGeneration(0)
  })

  createEffect(() => {
    const element = videoEl()
    const path = viewingPath()
    if (!element || !path || !props.contentVisible() || !videoPlaybackActive()) return
    const detach = playbackMediaHost.attach(element, 'video')
    onCleanup(() => {
      const state = playbackSession.getSnapshot()
      if (
        state.mode === 'video' &&
        state.desiredPlaying &&
        playbackPathMatches(state.currentItem, path)
      ) {
        playbackSession.dispatch({ type: 'pause' })
      }
      detach()
    })
  })

  const listDirForFiles = createMemo(() => dirFromWindow())

  const filesQuery = useQuery(() => {
    return {
      ...filesQueryOptions({ dir: listDirForFiles() }),
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

  const audioQueue = createMemo(() => {
    const queue = audioPlaybackQueueFromFiles(folderAudioFiles())
    const path = viewingPath()
    if (!path || mediaType() !== MediaType.AUDIO) return queue
    if (queue.some((item) => playbackPathMatches(item, path))) return queue
    return [...queue, playbackItemForPath(path, 'audio')]
  })
  const audioPlaybackActive = createMemo(() => {
    const state = playback()
    return (
      mediaType() === MediaType.AUDIO &&
      state.mode === 'audio' &&
      state.currentItem?.media === 'audio' &&
      playbackPathMatches(state.currentItem, viewingPath())
    )
  })
  const audioPlaying = createMemo(() => audioPlaybackActive() && playback().desiredPlaying)
  const audioCurrentTime = createMemo(() => (audioPlaybackActive() ? playback().position : 0))
  const audioDuration = createMemo(() => (audioPlaybackActive() ? playback().duration : 0))
  const audioVolume = createMemo(() => playback().volume)
  const audioMuted = createMemo(() => playback().muted)
  const audioLoading = createMemo(() => audioPlaybackActive() && playback().phase === 'resolving')
  const audioError = createMemo(() => (audioPlaybackActive() ? playback().error : null))

  function audioItem(path: string): PlaybackItem {
    return (
      audioQueue().find((item) => playbackPathMatches(item, path)) ??
      playbackItemForPath(path, 'audio')
    )
  }

  function loadAudio(path: string, autoplay: boolean, position?: number) {
    playbackSession.dispatch({
      type: 'load',
      item: audioItem(path),
      queue: audioQueue(),
      autoplay,
      mode: 'audio',
      ...(position === undefined ? {} : { position }),
    })
  }

  function toggleAudioPlayback() {
    const path = viewingPath()
    if (!path) return
    props.onAudioActivate?.()
    if (audioPlaybackActive()) playbackSession.dispatch({ type: 'toggle' })
    else loadAudio(path, true)
  }

  function seekAudio(time: number) {
    if (!Number.isFinite(time)) return
    const path = viewingPath()
    if (!path) return
    props.onAudioActivate?.()
    if (audioPlaybackActive()) playbackSession.dispatch({ type: 'seek', position: time })
    else loadAudio(path, false, time)
  }

  function setAudioPlayerVolume(volume: number) {
    playbackSession.dispatch({ type: 'setVolume', volume })
  }

  function toggleAudioMute() {
    playbackSession.dispatch({ type: 'setMuted', muted: !playback().muted })
  }

  function selectAudioFile(file: FileItem) {
    const controlledCurrent = audioPlaybackActive()
    props.onAudioActivate?.()
    props.onUpdateViewing(props.windowId, file.path)
    if (controlledCurrent) {
      const queue = audioPlaybackQueueFromFiles(folderAudioFiles())
      const item = queue.find((candidate) => playbackPathMatches(candidate, file.path))
      if (item) {
        playbackSession.dispatch({
          type: 'load',
          item,
          queue,
          autoplay: false,
          mode: 'audio',
        })
      }
    }
  }

  let offeredInitialAudioPath = ''
  createEffect(() => {
    const path = viewingPath()
    if (
      props.autoPlayVideo !== false ||
      !path ||
      mediaType() !== MediaType.AUDIO ||
      !props.contentVisible() ||
      offeredInitialAudioPath === normalizedPlaybackPath(path)
    ) {
      return
    }
    offeredInitialAudioPath = normalizedPlaybackPath(path)
    if (!playback().currentItem) loadAudio(path, false)
  })

  createEffect(() => {
    if (!audioPlaybackActive()) return
    const state = playback()
    const queue = audioQueue()
    if (queue.length === 0 || !state.currentItem) return
    const sameQueue =
      state.queue.length === queue.length &&
      state.queue.every((item, index) => {
        const candidate = queue[index]
        return (
          !!candidate &&
          playbackItemKey(item) === playbackItemKey(candidate) &&
          item.locator === candidate.locator &&
          item.name === candidate.name &&
          item.media === candidate.media
        )
      })
    if (!sameQueue) {
      playbackSession.dispatch({ type: 'setQueue', queue, current: state.currentItem })
    }
  })

  function retryMedia() {
    if (videoPlaybackActive() || audioPlaybackActive()) {
      playbackSession.dispatch({ type: 'retry' })
    }
  }

  function handleListenOnly() {
    const path = viewingPath()
    if (!path) return
    const elementTime = videoEl()?.currentTime
    const position =
      elementTime !== undefined && Number.isFinite(elementTime)
        ? elementTime
        : videoPlaybackActive()
          ? playback().position
          : 0
    if (videoPlaybackActive()) {
      playbackSession.dispatch({ type: 'seek', position })
      playbackSession.dispatch({ type: 'setMode', mode: 'audio' })
      playbackSession.dispatch({ type: 'play' })
    } else {
      playbackSession.dispatch({
        type: 'load',
        item: playbackItemForPath(path, 'video'),
        autoplay: true,
        position,
        mode: 'audio',
      })
    }
    props.onListenOnlyDismissViewer?.()
  }

  const audioMetadataUrl = createMemo(() => {
    const path = viewingPath()
    if (!path || mediaType() !== MediaType.AUDIO) return ''
    return buildAudioMetadataUrl(path)
  })

  const audioMetadataQuery = useQuery(() => ({
    queryKey: queryKeys.audioMetadata(viewingPath()),
    queryFn: () => fetchAudioMetadata(audioMetadataUrl()),
    enabled: !!audioMetadataUrl(),
    refetchOnWindowFocus: false,
  }))

  const playlistMetadataQueries = useQueries(() => ({
    queries: folderAudioFiles().map((file) => {
      const url = buildAudioMetadataUrl(file.path)
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
    return buildAdminMediaUrl(cover.path)
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
      if (!props.contentVisible()) return
      const active = props.workspace()?.activeWindowId === props.windowId
      const focused = !!paneEl?.contains(document.activeElement)
      if (!active && !focused) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') != null) {
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopImmediatePropagation()
        goPrevImage()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopImmediatePropagation()
        goNextImage()
      }
    }
    window.addEventListener('keydown', handler, true)
    onCleanup(() => window.removeEventListener('keydown', handler, true))
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

  const textQueryKey = createMemo(() => queryKeys.textContent(currentTextTarget().viewingPath))

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
        await apiEndpoints.files.edit({ path: target.viewingPath, content })
        return content
      })
    },
    onSuccess: (content: string, variables) => {
      if (isCurrentSaveTarget(variables)) setSavedContentAwaitingQuery(content)
      queryClient.setQueryData(variables.queryKey, content)
      void queryClient.invalidateQueries({ queryKey: variables.queryKey })
    },
    onSettled: () => invalidateFileQueries(queryClient),
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
  const resolveImageUrl = createMemo(() => buildResolveMarkdownImageUrl(viewingPath(), kbList()))

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
                  onClick={() => selectAudioFile(file)}
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
      ref={paneEl}
      data-no-window-drag
      class='absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background'
    >
      <Show when={readerKind() && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <ReaderDialog
              sourcePath={sourcePath}
              sourceKind={readerKind()!}
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
                aria-label='Zoom out'
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
                aria-label='Zoom in'
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
                aria-label='Fit to screen'
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
                aria-label='Rotate clockwise'
                class='inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                onClick={() => setRotation((r) => (r + 90) % 360)}
              >
                <RotateCw class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <button
                type='button'
                aria-label='Download image'
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
            <ReaderDialog sourcePath={sourcePath} sourceKind='pdf' embedded showClose={false} />
          </div>
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.BOOK && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <ReaderDialog sourcePath={sourcePath} sourceKind='book' embedded showClose={false} />
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
                  aria-label='Listen only'
                  class='bg-secondary inline-flex h-7 w-7 items-center justify-center rounded-md'
                  onClick={handleListenOnly}
                >
                  <Headphones class='h-4 w-4' stroke-width={2} />
                </button>
              </div>
            </Show>
            <Show when={videoLoading() && !videoError()}>
              <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45 text-white'>
                <LoaderCircle class='h-7 w-7 animate-spin' stroke-width={2} />
              </div>
            </Show>
            <Show when={videoError()}>
              <div class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center text-white'>
                <p class='text-sm'>{videoError()}</p>
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
              data-playback-media-host={
                videoPlaybackActive() && props.contentVisible() ? 'video' : undefined
              }
              title={fileName()}
              onCanPlay={() => setVideoReadyGeneration(playback().source?.generation ?? 0)}
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
          <Show when={audioLoading() && !audioError()}>
            <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/55 backdrop-blur-sm'>
              <LoaderCircle class='h-7 w-7 animate-spin text-muted-foreground' stroke-width={2} />
            </div>
          </Show>
          <Show when={audioError()}>
            <div class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center'>
              <p class='text-destructive text-sm'>{audioError()}</p>
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
                  aria-label='Copy to clipboard'
                  class='hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md text-sm'
                  onClick={() => void handleCopy()}
                >
                  {copied() ? '✓' : '⎘'}
                </button>
              </Show>
              <button
                type='button'
                title='Download'
                aria-label='Download'
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
