import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useWorkspacePlaybackStore } from '@/lib/workspace-playback-store'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getMediaType } from '@/lib/media-utils'
import { stripSharePrefix } from '@/lib/source-context'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { isPathEditable } from '@/lib/utils'
import Download from 'lucide-solid/icons/download'
import ExternalLink from 'lucide-solid/icons/external-link'
import Headphones from 'lucide-solid/icons/headphones'
import MonitorPlay from 'lucide-solid/icons/monitor-play'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import RotateCw from 'lucide-solid/icons/rotate-cw'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import type { Accessor } from 'solid-js'
import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { useStoreSync } from '../lib/solid-store-sync'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import { MarkdownPane } from '../media/MarkdownPane'
import type { TextViewerShareContext } from '../media/TextViewerDialog'
import type { WorkspaceShareConfig } from './WorkspaceBrowserPane'

type Props = {
  windowId: string
  storageKey: string
  contentVisible: Accessor<boolean>
  workspace: Accessor<PersistedWorkspaceState | null>
  sharePanel: Accessor<WorkspaceShareConfig | null>
  editableFolders: string[]
  shareCanEdit: boolean
  onUpdateViewing: (windowId: string, path: string) => void
  onDismissFloatingPlayer?: (windowId: string) => void
}

function shareEditRelativePath(viewingPath: string, sharePath: string): string {
  const sp = sharePath.replace(/\\/g, '/')
  const fileFwd = viewingPath.replace(/\\/g, '/')
  return fileFwd.startsWith(sp + '/') ? fileFwd.slice(sp.length + 1) : fileFwd
}

function buildResolveImageUrl(
  viewingPath: string,
  share: TextViewerShareContext | null,
): (src: string) => string | null {
  return (rawSrc: string) => {
    let src = rawSrc
    try {
      src = decodeURIComponent(src)
    } catch {
      /* noop */
    }

    if (share) {
      if (src.startsWith('http://') || src.startsWith('https://')) return src
      const fileDir = viewingPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
      const shareRoot = share.sharePath.replace(/\\/g, '/')
      const firstSeg = (p: string) => p.split('/').filter(Boolean)[0] ?? ''
      const isAbsolute =
        src.startsWith('/') ||
        (fileDir && (src === fileDir || src.startsWith(fileDir + '/'))) ||
        (shareRoot && (src === shareRoot || src.startsWith(shareRoot + '/'))) ||
        (firstSeg(src) && firstSeg(src) === firstSeg(viewingPath))
      let resolvedPath = isAbsolute
        ? src.startsWith('/')
          ? src.slice(1)
          : src
        : `${fileDir ? fileDir + '/' : ''}${src}`.replace(/\/+/g, '/').replace(/^\/+/, '')
      if (share.isDirectory && shareRoot && resolvedPath.startsWith(shareRoot + '/')) {
        resolvedPath = resolvedPath.slice(shareRoot.length).replace(/^\/+/, '')
      } else if (share.isDirectory && shareRoot && resolvedPath === shareRoot) {
        return null
      } else if (!share.isDirectory && resolvedPath !== shareRoot) {
        return null
      }
      const encoded = resolvedPath
        .split('/')
        .filter(Boolean)
        .map((s) => encodeURIComponent(s))
        .join('/')
      return encoded ? `/api/share/${share.token}/media/${encoded}` : null
    }

    return `/api/media/${src.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
  }
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

  const mediaType = createMemo(() =>
    getMediaType(viewingPath().split('.').pop()?.toLowerCase() ?? ''),
  )

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
    if (sh) {
      const rel = stripSharePrefix(path.replace(/\\/g, '/'), sh.sharePath)
      return `/api/share/${sh.token}/download?path=${encodeURIComponent(rel)}`
    }
    return `/api/files/download?path=${encodeURIComponent(path)}`
  })

  const dirFromWindow = createMemo(() => win()?.initialState?.dir ?? '')

  const storeTick = useStoreSync(useMediaPlayer)
  const wxPlaybackTick = useStoreSync(useWorkspacePlaybackStore)
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | undefined>()
  const playPauseSyncRef: { path: string; prevStorePlaying: boolean | undefined } = {
    path: '',
    prevStorePlaying: undefined,
  }

  const workspaceAudioOnly = createMemo(() => {
    void wxPlaybackTick()
    return useWorkspacePlaybackStore.getState().byKey[props.storageKey]?.audioOnly ?? false
  })

  const viewerShowVideoSurface = createMemo(
    () => mediaType() === MediaType.VIDEO && !workspaceAudioOnly(),
  )

  createEffect(() => {
    const path = viewingPath()
    const mt = mediaType()
    const key = props.storageKey

    onCleanup(() => {
      if (mt !== MediaType.VIDEO || !path || !key) return
      const slice = useWorkspacePlaybackStore.getState().byKey[key]
      if (slice?.playing === path) {
        useWorkspacePlaybackStore.getState().closePlayer(key)
        const st = useMediaPlayer.getState()
        if (st.currentFile === path && st.mediaType === 'video') {
          useMediaPlayer.getState().setIsPlaying(false)
        }
      }
    })

    if (!key || mt !== MediaType.VIDEO || !path) return
  })

  createEffect(() => {
    const path = viewingPath()
    const mt = mediaType()
    const key = props.storageKey
    const visible = props.contentVisible()
    if (!key || mt !== MediaType.VIDEO || !path || !visible) return

    const dir = dirFromWindow() || undefined
    useWorkspacePlaybackStore.getState().playFile(key, path, dir)
    useMediaPlayer.getState().startOrResumePlayback(path, 'video')
    props.onDismissFloatingPlayer?.(props.windowId)
  })

  createEffect(() => {
    void wxPlaybackTick()
    const path = viewingPath()
    const key = props.storageKey
    const vid = videoEl()
    if (!key || mediaType() !== MediaType.VIDEO || !path || !vid) return
    const playing = useWorkspacePlaybackStore.getState().byKey[key]?.playing
    if (playing && playing !== path) {
      vid.pause()
    }
  })

  createEffect(() => {
    const path = viewingPath()
    const url = mediaUrl()
    const vid = videoEl()
    if (!path || !viewerShowVideoSurface() || !vid || !url) return

    useMediaPlayer.getState().setCurrentFile(path, 'video')

    const abs = new URL(url, window.location.origin).href
    if (vid.src !== abs) {
      vid.src = url
      vid.load()
      if (useMediaPlayer.getState().isPlaying) {
        void vid.play().catch(() => {})
      }
    }
  })

  createEffect(() => {
    const vid = videoEl()
    const path = viewingPath()
    if (!vid || !viewerShowVideoSurface() || !path) return

    const applies = () => {
      const st = useMediaPlayer.getState()
      return st.currentFile === path && st.mediaType === 'video'
    }

    const onTimeUpdate = () => {
      if (!applies()) return
      useMediaPlayer.getState().setCurrentTime(vid.currentTime)
      if (
        'mediaSession' in navigator &&
        Number.isFinite(vid.duration) &&
        vid.duration > 0 &&
        !vid.paused
      ) {
        navigator.mediaSession.setPositionState?.({
          duration: vid.duration,
          playbackRate: vid.playbackRate,
          position: vid.currentTime,
        })
      }
    }

    const setDurationFromVideo = () => {
      if (!applies()) return
      const d = vid.duration
      if (Number.isFinite(d) && !Number.isNaN(d) && d > 0) {
        useMediaPlayer.getState().setDuration(d)
      }
    }

    const onLoadedMetadata = () => {
      setDurationFromVideo()
      if (
        'mediaSession' in navigator &&
        applies() &&
        Number.isFinite(vid.duration) &&
        vid.duration > 0
      ) {
        navigator.mediaSession.setPositionState?.({
          duration: vid.duration,
          playbackRate: vid.playbackRate,
          position: vid.currentTime,
        })
      }
    }

    const onPlay = () => {
      if (applies()) useMediaPlayer.getState().setIsPlaying(true)
    }

    const onPause = () => {
      if (applies()) useMediaPlayer.getState().setIsPlaying(false)
    }

    vid.addEventListener('timeupdate', onTimeUpdate)
    vid.addEventListener('durationchange', setDurationFromVideo)
    vid.addEventListener('loadedmetadata', onLoadedMetadata)
    vid.addEventListener('play', onPlay)
    vid.addEventListener('pause', onPause)

    onCleanup(() => {
      vid.removeEventListener('timeupdate', onTimeUpdate)
      vid.removeEventListener('durationchange', setDurationFromVideo)
      vid.removeEventListener('loadedmetadata', onLoadedMetadata)
      vid.removeEventListener('play', onPlay)
      vid.removeEventListener('pause', onPause)
    })
  })

  createEffect(() => {
    void storeTick()
    const vid = videoEl()
    const path = viewingPath()
    if (!vid || !viewerShowVideoSurface() || !path) return
    const st = useMediaPlayer.getState()
    if (st.currentFile !== path || st.mediaType !== 'video') return
    const t = st.currentTime
    if (!Number.isFinite(t)) return
    if (Math.abs(vid.currentTime - t) > 0.45) {
      vid.currentTime = t
    }
  })

  createEffect(() => {
    void storeTick()
    const vid = videoEl()
    const path = viewingPath()
    if (!vid || !viewerShowVideoSurface() || !path) return
    const st = useMediaPlayer.getState()
    if (st.currentFile !== path || st.mediaType !== 'video') return

    if (playPauseSyncRef.path !== path) {
      playPauseSyncRef.path = path
      playPauseSyncRef.prevStorePlaying = undefined
    }

    const playingNow = st.isPlaying
    const prev = playPauseSyncRef.prevStorePlaying
    playPauseSyncRef.prevStorePlaying = playingNow

    if (prev === undefined) {
      return
    }
    if (playingNow && !prev) {
      void vid.play().catch(() => {})
    } else if (!playingNow && prev) {
      vid.pause()
    }
  })

  createEffect(() => {
    void storeTick()
    const vid = videoEl()
    if (!vid || !viewerShowVideoSurface()) return
    const st = useMediaPlayer.getState()
    vid.muted = st.isMuted
    vid.volume = st.isMuted ? 0 : st.volume
  })

  createEffect(() => {
    const vis = props.contentVisible()
    const vid = videoEl()
    const path = viewingPath()
    if (mediaType() !== MediaType.VIDEO || !path || !vid || !viewerShowVideoSurface()) return
    if (!vis) {
      vid.pause()
      return
    }
    const st = useMediaPlayer.getState()
    if (st.currentFile === path && st.mediaType === 'video' && st.isPlaying) {
      void vid.play().catch(() => {})
    }
  })

  function setWorkspaceAudioOnly(enabled: boolean) {
    useWorkspacePlaybackStore.getState().setAudioOnly(props.storageKey, enabled)
  }

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
      enabled: mediaType() === MediaType.IMAGE && Boolean(viewingPath()),
    }
  })

  const imageFiles = createMemo(() =>
    (filesQuery.data?.files ?? []).filter((f) => f.type === MediaType.IMAGE),
  )

  const [zoom, setZoom] = createSignal<number | 'fit'>('fit')
  const [rotation, setRotation] = createSignal(0)

  createEffect(() => {
    viewingPath()
    setZoom('fit')
    setRotation(0)
  })

  const fileName = createMemo(() => viewingPath().split(/[/\\]/).pop() ?? 'file')

  const currentImageIndex = createMemo(() =>
    imageFiles().findIndex((f) => f.path === viewingPath()),
  )
  const currentImageNumber = createMemo(() =>
    currentImageIndex() !== -1 ? currentImageIndex() + 1 : 1,
  )
  const totalImages = createMemo(() => imageFiles().length)

  function goNextImage() {
    const list = imageFiles()
    const vp = viewingPath()
    if (!vp || list.length === 0) return
    const i = list.findIndex((f) => f.path === vp)
    if (i === -1 || i === list.length - 1) return
    const nextFile = list[i + 1]
    props.onUpdateViewing(props.windowId, nextFile.path)
  }

  function goPrevImage() {
    const list = imageFiles()
    const vp = viewingPath()
    if (!vp || list.length === 0) return
    const i = list.findIndex((f) => f.path === vp)
    if (i === -1 || i === 0) return
    const prevFile = list[i - 1]
    props.onUpdateViewing(props.windowId, prevFile.path)
  }

  createEffect(() => {
    if (mediaType() !== MediaType.IMAGE || !viewingPath()) return
    const handler = (e: KeyboardEvent) => {
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
    const base: JSX.CSSProperties =
      z === 'fit'
        ? {
            width: '100%',
            height: '100%',
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
    const path = viewingPath()
    if (!path) return queryKeys.textContent('')
    const sh = share()
    return sh ? queryKeys.shareText(sh.token, path) : queryKeys.textContent(path)
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
  const [copied, setCopied] = createSignal(false)

  let lastTextPath = ''
  createEffect(() => {
    const path = viewingPath()
    const data = textQuery.data
    if (mediaType() !== MediaType.TEXT || !path || data === undefined) return
    if (path !== lastTextPath) {
      lastTextPath = path
      setReadOnlyView(false)
      setEditContent(data)
    }
  })

  const showEditor = createMemo(() => fileEditable() && !readOnlyView())

  const saveMutation = useMutation(() => ({
    mutationFn: async (content: string) => {
      const ctx = textViewerShareCtx()
      if (ctx) {
        const rel = shareEditRelativePath(viewingPath(), ctx.sharePath)
        await post(`/api/share/${ctx.token}/edit`, { path: rel, content })
      } else {
        await post('/api/files/edit', { path: viewingPath(), content })
      }
      return content
    },
    onSuccess: (content: string) => {
      const key = textQueryKey()
      queryClient.setQueryData(key, content)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  }))

  async function saveText(quiet: boolean) {
    if (editContent() === (textQuery.data ?? '')) return
    try {
      await saveMutation.mutateAsync(editContent())
    } catch (e) {
      if (!quiet) {
        window.alert(e instanceof Error ? e.message : 'Failed to save file')
      }
    }
  }

  let autosaveTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    onCleanup(() => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
    })
    if (!fileEditable() || readOnlyView()) return
    if (editContent() === (textQuery.data ?? '')) return
    autosaveTimer = setTimeout(() => {
      void saveText(true)
    }, 2000)
  })

  async function handleCopy() {
    const src = textQuery.data ?? ''
    if (!src) return
    try {
      await navigator.clipboard.writeText(src)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  function handlePdfOpenTab() {
    const u = mediaUrl()
    if (u) window.open(u, '_blank')
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

  const resolveImageUrl = createMemo(() =>
    buildResolveImageUrl(viewingPath(), textViewerShareCtx()),
  )

  return (
    <div
      data-no-window-drag
      class='absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background'
    >
      <Show when={mediaType() === MediaType.IMAGE && viewingPath()}>
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
                onClick={() =>
                  setZoom((prev) => {
                    const cur = prev === 'fit' ? 100 : prev
                    return Math.max(cur - 25, 25)
                  })
                }
              >
                <ZoomOut class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <span class='min-w-12 text-center text-xs text-white/80'>
                {zoom() === 'fit' ? 'Fit' : `${zoom()}%`}
              </span>
              <button
                type='button'
                class='inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                onClick={() =>
                  setZoom((prev) => {
                    const cur = prev === 'fit' ? 100 : prev
                    return Math.min(cur + 25, 400)
                  })
                }
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
          <div class='relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-2'>
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
            <img
              src={mediaUrl()}
              alt={fileName()}
              class='pointer-events-none max-h-full transition-transform duration-200'
              style={imgStyle()}
            />
          </div>
        </div>
      </Show>

      <Show when={mediaType() === MediaType.PDF && viewingPath()}>
        <div class='flex h-full min-h-0 flex-col'>
          <div class='flex h-8 shrink-0 items-center justify-end gap-0.5 border-b border-border bg-muted/50 px-1'>
            <button
              type='button'
              title='Open in new tab'
              class='text-muted-foreground hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md'
              onClick={handlePdfOpenTab}
            >
              <ExternalLink class='h-3.5 w-3.5' stroke-width={2} />
            </button>
            <button
              type='button'
              title='Download'
              class='text-muted-foreground hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md'
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
          <div class='flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-800'>
            <embed
              src={mediaUrl() ? `${mediaUrl()}#toolbar=1` : ''}
              type='application/pdf'
              class='h-full w-full'
              title={fileName()}
            />
          </div>
        </div>
      </Show>

      <Show when={mediaType() === MediaType.VIDEO && viewingPath()}>
        <div class='flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-black'>
          <Show
            when={workspaceAudioOnly()}
            fallback={
              <div class='group relative flex min-h-0 min-w-0 flex-1 flex-col bg-black'>
                <div class='absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100'>
                  <button
                    type='button'
                    title='Listen only'
                    class='bg-secondary inline-flex h-7 w-7 items-center justify-center rounded-md'
                    onClick={() => {
                      const vid = videoEl()
                      if (vid) useMediaPlayer.getState().setCurrentTime(vid.currentTime)
                      setWorkspaceAudioOnly(true)
                    }}
                  >
                    <Headphones class='h-4 w-4' stroke-width={2} />
                  </button>
                </div>
                <video
                  ref={(el) => setVideoEl(el ?? undefined)}
                  class='min-h-0 w-full flex-1 bg-black object-contain'
                  controls
                  playsinline
                  data-media-type={MediaType.VIDEO}
                  title={fileName()}
                />
              </div>
            }
          >
            <div class='bg-muted/20 flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center'>
              <div class='space-y-3'>
                <div class='bg-muted mx-auto flex h-12 w-12 items-center justify-center rounded-full'>
                  <Headphones class='text-muted-foreground h-6 w-6' stroke-width={2} />
                </div>
                <div class='text-sm font-medium'>{fileName()} is playing in audio mode</div>
                <div class='text-muted-foreground text-sm'>
                  Restore video playback from the taskbar audio controls or here.
                </div>
                <div>
                  <button
                    type='button'
                    class='border-input bg-background hover:bg-accent inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm'
                    onClick={() => {
                      const path = viewingPath()
                      if (path) useMediaPlayer.getState().setCurrentFile(path, 'video')
                      setWorkspaceAudioOnly(false)
                    }}
                  >
                    <MonitorPlay class='h-4 w-4' stroke-width={2} />
                    Show video
                  </button>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={mediaType() === MediaType.AUDIO && viewingPath()}>
        <div class='flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-muted/30 p-6'>
          <p class='text-muted-foreground text-sm'>{fileName()}</p>
          <audio src={mediaUrl()} controls class='w-full max-w-md' title={fileName()} />
        </div>
      </Show>

      <Show when={mediaType() === MediaType.TEXT && viewingPath()}>
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
                      setEditContent(textQuery.data ?? '')
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
            <Show when={textQuery.isPending}>
              <p class='text-muted-foreground p-3 text-sm'>Loading…</p>
            </Show>
            <Show when={textQuery.isError}>
              <p class='text-destructive p-3 text-sm'>Failed to load file.</p>
            </Show>
            <Show when={!textQuery.isPending && !textQuery.isError}>
              <Show
                when={showEditor()}
                fallback={
                  <Show
                    when={isMarkdown()}
                    fallback={
                      <div class='scrollbar-thin h-full overflow-auto'>
                        <pre class='text-foreground wrap-break-word whitespace-pre-wrap px-3 py-2 font-sans text-base leading-[1.75]'>
                          {textQuery.data ?? ''}
                        </pre>
                      </div>
                    }
                  >
                    <MarkdownPane
                      content={textQuery.data ?? ''}
                      resolveImageUrl={resolveImageUrl()}
                    />
                  </Show>
                }
              >
                <div class='h-full'>
                  <textarea
                    class='scrollbar-thin h-full w-full resize-none bg-transparent px-3 py-2 font-sans text-base leading-[1.75] text-foreground wrap-break-word whitespace-pre-wrap focus:outline-none'
                    value={editContent()}
                    spellcheck={false}
                    onInput={(e) => setEditContent(e.currentTarget.value)}
                    onBlur={() => void saveText(true)}
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
            </Show>
          </div>
        </div>
      </Show>

      <Show when={mediaType() === MediaType.OTHER && viewingPath()}>
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
