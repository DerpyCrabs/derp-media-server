import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { MediaType, type FileItem } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { stripSharePrefix } from '@/lib/source-context'
import Download from 'lucide-solid/icons/download'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import RotateCw from 'lucide-solid/icons/rotate-cw'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import X from 'lucide-solid/icons/x'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { createResponsiveImage } from '../lib/responsive-image'
import { closeViewer, viewFile } from '../lib/url-state-actions'
import {
  OWNER_OPEN_SCOPE,
  grantOpenScope,
  resourceForFileItem,
} from '../lib/legacy-resource-adapter'
import { executeOpenPlan, openResource } from '../lib/open-resource'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

type ShareCtx = { token: string; sharePath: string }

function useDirFromUrl() {
  const history = useBrowserHistory()
  const sp = createUrlSearchParamsMemo(history)
  const dir = createMemo(() => {
    const p = sp()
    return p.get('dir') ?? ''
  })
  return dir
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
  const urlSearchParams = createUrlSearchParamsMemo(history)

  const dirFromUrl = createMemo(() => urlSearchParams().get('dir') ?? '')

  const imageFiles = createMemo(() => props.allFiles().filter((f) => f.type === MediaType.IMAGE))

  function planImageViewer(file: FileItem) {
    return openResource(resourceForFileItem(file), 'view', {
      surface: props.shareContext ? 'share' : 'library',
      scope: props.shareContext ? grantOpenScope(props.shareContext.token) : OWNER_OPEN_SCOPE,
    })
  }

  const [zoom, setZoom] = createSignal<number | 'fit'>('fit')
  const [rotation, setRotation] = createSignal(0)
  const [imageSurface, setImageSurface] = createSignal<HTMLDivElement>()
  let activePointer: number | null = null
  let gestureStartX = 0
  let lastTouchAt = 0
  let wheelDelta = 0
  let wheelResetTimer: ReturnType<typeof setTimeout> | undefined
  let wheelFlushTimer: ReturnType<typeof setTimeout> | undefined
  let pendingWheelSteps = 0
  let viewerElement!: HTMLDivElement

  const fileName = createMemo(() => props.viewingPath.split(/[/\\]/).pop() || '')

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
  const prefetchPaths = createMemo(() => {
    const index = currentIndex()
    return index < 0
      ? []
      : imageFiles()
          .slice(index + 1, index + 3)
          .map((file) => file.path)
  })
  const responsiveImage = createResponsiveImage({
    path: () => props.viewingPath,
    context: () => props.shareContext,
    viewport: imageSurface,
    zoom,
    prefetchPaths,
    onDisplayPath: () => {
      setZoom('fit')
      setRotation(0)
    },
  })

  function handleClose() {
    closeViewer()
    setZoom('fit')
    setRotation(0)
  }

  function moveImage(offset: number) {
    const list = imageFiles()
    const vp = props.viewingPath
    if (!vp || list.length === 0) return
    const i = list.findIndex((f) => f.path === vp)
    if (i === -1) return
    const target = Math.max(0, Math.min(list.length - 1, i + offset))
    if (target === i) return
    const file = list[target]
    const plan = planImageViewer(file)
    executeOpenPlan(plan, (planned) => {
      if (planned.kind !== 'viewer' || planned.viewer.id !== 'image-viewer') return
      const d = dirFromUrl()
      viewFile(file.path, d || undefined, planned.viewer.id)
    })
  }

  function goNext() {
    moveImage(1)
  }

  function goPrevious() {
    moveImage(-1)
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

  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType !== 'touch') return
    if (activePointer !== null) return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Synthetic pointer events used by embedded browsers and tests may not be capturable.
    }
    activePointer = e.pointerId
    gestureStartX = e.clientX
  }

  function handlePointerUp(e: PointerEvent) {
    if (e.pointerType !== 'touch') return
    lastTouchAt = Date.now()
    if (activePointer !== e.pointerId) return
    const deltaX = e.clientX - gestureStartX
    activePointer = null
    if ((zoom() === 'fit' || zoom() === 100) && Math.abs(deltaX) >= 50) {
      if (deltaX < 0) goNext()
      else goPrevious()
    }
  }

  function handlePointerCancel(e: PointerEvent) {
    if (e.pointerType !== 'touch') return
    if (activePointer === e.pointerId) activePointer = null
  }

  function handleDesktopZoneClick(direction: 'previous' | 'next') {
    if (Date.now() - lastTouchAt < 700) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    if (direction === 'previous') goPrevious()
    else goNext()
  }

  function handleWheel(e: WheelEvent) {
    if (e.ctrlKey || !window.matchMedia('(pointer: fine)').matches) return
    e.preventDefault()

    const multiplier =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1
    wheelDelta += e.deltaY * multiplier
    clearTimeout(wheelResetTimer)
    wheelResetTimer = setTimeout(() => {
      wheelDelta = 0
    }, 150)

    if (Math.abs(wheelDelta) < 40) return
    pendingWheelSteps += wheelDelta > 0 ? 1 : -1
    wheelDelta = 0
    flushWheelSteps()
  }

  function flushWheelSteps() {
    if (wheelFlushTimer || pendingWheelSteps === 0) return
    const steps = pendingWheelSteps
    pendingWheelSteps = 0
    moveImage(steps)
    wheelFlushTimer = setTimeout(() => {
      wheelFlushTimer = undefined
      flushWheelSteps()
    }, 100)
  }

  onCleanup(() => {
    clearTimeout(wheelResetTimer)
    clearTimeout(wheelFlushTimer)
  })

  onMount(() => {
    viewerElement.addEventListener('wheel', handleWheel, { passive: false })
    onCleanup(() => viewerElement.removeEventListener('wheel', handleWheel))
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

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby='image-viewer-title'
      class='fixed inset-0 z-50 flex flex-col bg-black/95'
      ref={viewerElement}
    >
      <span class='sr-only'>
        <h2 id='image-viewer-title'>{fileName()}</h2>
      </span>
      <div class='flex items-center bg-black/50 p-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] backdrop-blur-sm sm:p-4 sm:pt-[calc(1rem+env(safe-area-inset-top,0px))]'>
        <div class='min-w-0 flex-1'>
          <h2 class='truncate text-sm font-medium text-white sm:text-lg'>{fileName()}</h2>
        </div>
        <Show when={totalImages() > 0}>
          <div class='hidden shrink-0 px-3 sm:block'>
            <span class='text-sm font-medium text-white'>
              {currentImageNumber()} of {totalImages()}
            </span>
          </div>
        </Show>
        <div class='flex shrink-0 items-center justify-end gap-1 sm:gap-2'>
          <button
            type='button'
            class='inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleZoomOut}
          >
            <ZoomOut class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <span class='hidden min-w-16 text-center text-sm text-white min-[480px]:inline'>
            {zoom() === 'fit' ? 'Fit' : `${zoom()}%`}
          </span>
          <button
            type='button'
            class='inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleZoomIn}
          >
            <ZoomIn class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <button
            type='button'
            title='Fit to screen'
            class='inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleFitToScreen}
          >
            <Maximize2 class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <button
            type='button'
            class='inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleRotate}
          >
            <RotateCw class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <div class='mx-1 h-6 w-px bg-white/20 sm:mx-2' />
          <button
            type='button'
            class='inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleDownload}
          >
            <Download class='h-5 w-5' size={20} stroke-width={2} />
          </button>
          <button
            type='button'
            class='inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            onClick={handleClose}
          >
            <X class='h-5 w-5' size={20} stroke-width={2} />
          </button>
        </div>
      </div>

      <div
        data-testid='image-gesture-surface'
        class='relative flex flex-1 touch-pan-y items-center justify-center p-4'
        classList={{ 'overflow-hidden': zoom() === 'fit', 'overflow-auto': zoom() !== 'fit' }}
        ref={setImageSurface}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div
          data-testid='image-previous-zone'
          class='absolute top-0 bottom-0 left-0 z-10 hidden w-[30%] cursor-pointer [@media(pointer:fine)]:block'
          onClick={() => handleDesktopZoneClick('previous')}
          role='presentation'
        />
        <div
          data-testid='image-next-zone'
          class='absolute top-0 right-0 bottom-0 z-10 hidden w-[30%] cursor-pointer [@media(pointer:fine)]:block'
          onClick={() => handleDesktopZoneClick('next')}
          role='presentation'
        />
        <Show when={responsiveImage.showSpinner()}>
          <LoaderCircle
            class='absolute top-1/2 left-1/2 z-20 h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/80'
            aria-label='Loading image'
          />
        </Show>
        <Show when={responsiveImage.error()}>
          <div class='z-20 flex flex-col items-center gap-3 text-white'>
            <p>Could not load image</p>
            <button
              type='button'
              class='rounded-md border border-white/30 px-3 py-1.5 hover:bg-white/10'
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
            class='pointer-events-none shrink-0 select-none'
            classList={{ invisible: responsiveImage.showSpinner() }}
            style={imgStyle()}
          />
        </Show>
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
  const urlSearchParams = createUrlSearchParamsMemo(history)

  const viewingPath = createMemo(() => urlSearchParams().get('viewing'))

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
