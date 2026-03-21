import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { MediaType, type FileItem } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { stripSharePrefix } from '@/lib/source-context'
import Download from 'lucide-solid/icons/download'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import RotateCw from 'lucide-solid/icons/rotate-cw'
import X from 'lucide-solid/icons/x'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
  type JSX,
} from 'solid-js'
import { useBrowserHistory } from '../browser-history'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import { closeViewer, viewFile } from '../lib/url-state-actions'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

type ShareCtx = { token: string; sharePath: string }

function useDirFromUrl() {
  const history = useBrowserHistory()
  const dirMemo = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('dir') ?? ''
  })
  return dirMemo
}

function useDirToFetch(viewingPath: () => string, dirFromUrl: Accessor<string>) {
  const dirToFetchMemo = createMemo(() => {
    let dir = dirFromUrl()
    if (!dir && viewingPath()) {
      const pathParts = viewingPath().split(/[/\\]/)
      pathParts.pop()
      dir = pathParts.join('/')
    }
    return dir
  })
  return dirToFetchMemo
}

function ImageViewerInner(props: {
  viewingPath: string
  shareContext: ShareCtx | null
  allFiles: Accessor<FileItem[]>
}): JSX.Element {
  const history = useBrowserHistory()

  const dirFromUrl = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('dir') ?? ''
  })

  const imageFiles = createMemo(() => props.allFiles().filter((f) => f.type === MediaType.IMAGE))

  const [zoom, setZoom] = createSignal<number | 'fit'>('fit')
  const [rotation, setRotation] = createSignal(0)

  createEffect(() => {
    void props.viewingPath
    setZoom('fit')
    setRotation(0)
  })

  const fileName = createMemo(() => props.viewingPath.split(/[/\\]/).pop() || '')

  const mediaUrl = createMemo(() => {
    const path = props.viewingPath
    const ctx = props.shareContext
    return ctx ? buildShareMediaUrl(ctx.token, ctx.sharePath, path) : buildAdminMediaUrl(path)
  })

  const downloadHref = createMemo(() => {
    const path = props.viewingPath
    const ctx = props.shareContext
    if (ctx) {
      const relative = stripSharePrefix(path, ctx.sharePath)
      return `/api/share/${ctx.token}/download?path=${encodeURIComponent(relative || '.')}`
    }
    return `/api/files/download?path=${encodeURIComponent(path)}`
  })

  const currentIndex = createMemo(() => imageFiles().findIndex((f) => f.path === props.viewingPath))
  const currentImageNumber = createMemo(() => (currentIndex() !== -1 ? currentIndex() + 1 : 1))
  const totalImages = createMemo(() => imageFiles().length)

  function handleClose() {
    closeViewer()
    setZoom('fit')
    setRotation(0)
  }

  function goNext() {
    const list = imageFiles()
    const vp = props.viewingPath
    if (!vp || list.length === 0) return
    const i = list.findIndex((f) => f.path === vp)
    if (i === -1 || i === list.length - 1) return
    const nextFile = list[i + 1]
    const d = dirFromUrl()
    viewFile(nextFile.path, d || undefined)
  }

  function goPrevious() {
    const list = imageFiles()
    const vp = props.viewingPath
    if (!vp || list.length === 0) return
    const i = list.findIndex((f) => f.path === vp)
    if (i === -1 || i === 0) return
    const prevFile = list[i - 1]
    const d = dirFromUrl()
    viewFile(prevFile.path, d || undefined)
  }

  createEffect(() => {
    if (!props.viewingPath) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrevious()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', handler)
    onCleanup(() => window.removeEventListener('keydown', handler))
  })

  function handleDownload() {
    const link = document.createElement('a')
    link.href = downloadHref()
    link.download = fileName()
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function handleZoomIn() {
    setZoom((prev) => {
      const currentZoom = prev === 'fit' ? 100 : prev
      return Math.min(currentZoom + 25, 400)
    })
  }

  function handleZoomOut() {
    setZoom((prev) => {
      const currentZoom = prev === 'fit' ? 100 : prev
      return Math.max(currentZoom - 25, 25)
    })
  }

  function handleRotate() {
    setRotation((prev) => (prev + 90) % 360)
  }

  function handleFitToScreen() {
    setZoom('fit')
    setRotation(0)
  }

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

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby='image-viewer-title'
      class='fixed inset-0 z-50 flex flex-col bg-black/95'
    >
      <span class='sr-only'>
        <h2 id='image-viewer-title'>{fileName()}</h2>
      </span>
      <div class='flex items-center justify-between bg-black/50 p-4 backdrop-blur-sm'>
        <div class='flex-1'>
          <h2 class='max-w-md truncate text-lg font-medium text-white'>{fileName()}</h2>
        </div>
        <Show when={totalImages() > 0}>
          <div class='shrink-0 px-4'>
            <span class='text-sm font-medium text-white'>
              {currentImageNumber()} of {totalImages()}
            </span>
          </div>
        </Show>
        <div class='flex flex-1 items-center justify-end gap-2'>
          <button
            type='button'
            class='inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleZoomOut}
          >
            <ZoomOut class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <span class='min-w-16 text-center text-sm text-white'>
            {zoom() === 'fit' ? 'Fit' : `${zoom()}%`}
          </span>
          <button
            type='button'
            class='inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleZoomIn}
          >
            <ZoomIn class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <button
            type='button'
            title='Fit to screen'
            class='inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleFitToScreen}
          >
            <Maximize2 class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <button
            type='button'
            class='inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleRotate}
          >
            <RotateCw class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <div class='mx-2 h-6 w-px bg-white/20' />
          <button
            type='button'
            class='inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleDownload}
          >
            <Download class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <button
            type='button'
            class='inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleClose}
          >
            <X class='h-5 w-5' size={20} stroke-width={2} />
          </button>
        </div>
      </div>

      <div class='relative flex flex-1 items-center justify-center overflow-auto p-4'>
        <div
          class='absolute top-0 bottom-0 left-0 z-10 w-[30%] cursor-pointer'
          onClick={goPrevious}
          role='presentation'
        />
        <div
          class='absolute top-0 right-0 bottom-0 z-10 w-[30%] cursor-pointer'
          onClick={goNext}
          role='presentation'
        />
        <img
          src={mediaUrl()}
          alt={fileName()}
          class='pointer-events-none transition-transform duration-200'
          style={imgStyle()}
        />
      </div>
    </div>
  )
}

function ImageViewerBodyAdmin(props: { viewingPath: string }): JSX.Element {
  const dirFromUrl = useDirFromUrl()
  const dirToFetch = useDirToFetch(() => props.viewingPath, dirFromUrl)
  const filesQuery = useQuery(() => ({
    queryKey: queryKeys.files(dirToFetch()),
    queryFn: () => api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(dirToFetch())}`),
  }))
  const allFiles = () => filesQuery.data?.files ?? []
  return (
    <ImageViewerInner viewingPath={props.viewingPath} shareContext={null} allFiles={allFiles} />
  )
}

function ImageViewerBodyShare(props: { viewingPath: string; shareContext: ShareCtx }): JSX.Element {
  const dirFromUrl = useDirFromUrl()
  const dirToFetch = useDirToFetch(() => props.viewingPath, dirFromUrl)
  const filesQuery = useQuery(() => {
    const qDir = stripSharePrefix(dirToFetch(), props.shareContext.sharePath)
    return {
      queryKey: queryKeys.shareFiles(props.shareContext.token, qDir),
      queryFn: () =>
        api<{ files: FileItem[] }>(
          `/api/share/${props.shareContext.token}/files?dir=${encodeURIComponent(qDir)}`,
        ),
    }
  })
  const allFiles = () => filesQuery.data?.files ?? []
  return (
    <ImageViewerInner
      viewingPath={props.viewingPath}
      shareContext={props.shareContext}
      allFiles={allFiles}
    />
  )
}

export function ImageViewerDialog(props: Props) {
  const history = useBrowserHistory()

  const viewingPath = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('viewing')
  })

  const extension = createMemo(() => (viewingPath() || '').split('.').pop()?.toLowerCase() || '')
  const isImage = createMemo(() => !!viewingPath() && getMediaType(extension()) === MediaType.IMAGE)

  return (
    <Show when={viewingPath() && isImage()}>
      <Show
        when={props.shareContext}
        fallback={<ImageViewerBodyAdmin viewingPath={viewingPath()!} />}
      >
        {(ctx) => <ImageViewerBodyShare viewingPath={viewingPath()!} shareContext={ctx()!} />}
      </Show>
    </Show>
  )
}
