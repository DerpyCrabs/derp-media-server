import { MediaType, type FileItem } from '@/lib/files/types'
import Download from 'lucide-solid/icons/download'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import RotateCw from 'lucide-solid/icons/rotate-cw'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import X from 'lucide-solid/icons/x'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import { Show, createMemo, createSignal, onSettled, type Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { createUrlSearchParamsMemo, useBrowserHistory } from '@/lib/browser/browser-history'
import { createResponsiveImage } from '@/features/viewer/responsive-image'
import { closeViewer, viewFile } from '@/lib/browser/url-state-actions'

export type ImageViewerPaneProps = {
  viewingPath: string
  allFiles: Accessor<FileItem[]>
  directory?: Accessor<string>
  embedded?: boolean
  showClose?: boolean
  active?: Accessor<boolean>
  onNavigate?: (path: string) => void
  onClose?: () => void
}

export function ImageViewerPane(props: ImageViewerPaneProps): JSX.Element {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)

  const dirFromUrl = createMemo(() => urlSearchParams().get('dir') ?? '')
  const directory = createMemo(() => props.directory?.() ?? dirFromUrl())

  const imageFiles = createMemo(() => props.allFiles().filter((f) => f.type === MediaType.IMAGE))

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
  let viewerElement: HTMLDivElement | undefined

  const fileName = createMemo(() => props.viewingPath.split(/[/\\]/).pop() || '')

  const downloadHref = createMemo(() => {
    const path = props.viewingPath
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
    viewport: imageSurface,
    zoom,
    prefetchPaths,
    onDisplayPath: () => {
      setZoom('fit')
      setRotation(0)
    },
  })

  function handleClose() {
    if (props.onClose) props.onClose()
    else closeViewer()
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
    const path = list[target].path
    if (props.onNavigate) props.onNavigate(path)
    else viewFile(path, directory() || undefined)
  }

  function goNext() {
    moveImage(1)
  }

  function goPrevious() {
    moveImage(-1)
  }

  onSettled(() => {
    if (!props.viewingPath) return undefined
    const handler = (e: KeyboardEvent) => {
      if (props.active && !props.active()) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopImmediatePropagation()
        goPrevious()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopImmediatePropagation()
        goNext()
      }
    }
    window.addEventListener('keydown', handler, true)
    // eslint-disable-next-line solid/reactivity
    return () => window.removeEventListener('keydown', handler, true)
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

  onSettled(() => {
    if (!viewerElement) return undefined
    const element = viewerElement
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', handleWheel)
      clearTimeout(wheelResetTimer)
      clearTimeout(wheelFlushTimer)
    }
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
      role={props.embedded ? undefined : 'dialog'}
      aria-modal={props.embedded ? undefined : 'true'}
      aria-labelledby='image-viewer-title'
      class={
        props.embedded
          ? 'flex h-full min-h-0 flex-col bg-black'
          : 'fixed inset-0 z-50 flex flex-col bg-black/95'
      }
      ref={(element) => {
        viewerElement = element
      }}
    >
      <span class='sr-only'>
        <h2 id='image-viewer-title'>{fileName()}</h2>
      </span>
      <div
        class={
          props.embedded
            ? 'flex h-8 shrink-0 items-center justify-between border-b border-white/10 bg-black/50 px-2'
            : 'flex items-center bg-black/50 p-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] backdrop-blur-sm sm:p-4 sm:pt-[calc(1rem+env(safe-area-inset-top,0px))]'
        }
      >
        <div class={props.embedded ? 'hidden' : 'min-w-0 flex-1'}>
          <h2 class='truncate text-sm font-medium text-white sm:text-lg'>{fileName()}</h2>
        </div>
        <Show when={totalImages() > 0}>
          <div class={props.embedded ? 'shrink-0' : 'hidden shrink-0 px-3 sm:block'}>
            <span class='text-sm font-medium text-white'>
              {currentImageNumber()} of {totalImages()}
            </span>
          </div>
        </Show>
        <div class='flex shrink-0 items-center justify-end gap-1 sm:gap-2'>
          <button
            type='button'
            class={
              props.embedded
                ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                : 'inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            }
            onClick={handleZoomOut}
          >
            <ZoomOut
              class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'}
              size={20}
              stroke-width={2}
            />
          </button>
          <span
            class={
              props.embedded
                ? 'min-w-10 text-center text-xs text-white'
                : 'hidden min-w-16 text-center text-sm text-white min-[480px]:inline'
            }
          >
            {zoom() === 'fit' ? 'Fit' : `${zoom()}%`}
          </span>
          <button
            type='button'
            class={
              props.embedded
                ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                : 'inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            }
            onClick={handleZoomIn}
          >
            <ZoomIn class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'} size={20} stroke-width={2} />
          </button>
          <button
            type='button'
            title='Fit to screen'
            class={
              props.embedded
                ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                : 'inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            }
            onClick={handleFitToScreen}
          >
            <Maximize2
              class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'}
              size={20}
              stroke-width={2}
            />
          </button>
          <button
            type='button'
            class={
              props.embedded
                ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                : 'inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            }
            onClick={handleRotate}
          >
            <RotateCw
              class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'}
              size={20}
              stroke-width={2}
            />
          </button>
          <div
            class={
              props.embedded ? 'mx-0.5 h-5 w-px bg-white/20' : 'mx-1 h-6 w-px bg-white/20 sm:mx-2'
            }
          />
          <button
            type='button'
            class={
              props.embedded
                ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                : 'inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
            }
            onClick={handleDownload}
          >
            <Download
              class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'}
              size={20}
              stroke-width={2}
            />
          </button>
          <Show when={props.showClose !== false}>
            <button
              type='button'
              title='Close'
              aria-label='Close'
              class={
                props.embedded
                  ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                  : 'inline-flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
              }
              onClick={handleClose}
            >
              <X class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'} size={20} stroke-width={2} />
            </button>
          </Show>
        </div>
      </div>

      <div
        data-testid={props.embedded ? 'workspace-image-surface' : 'image-gesture-surface'}
        class={[
          props.embedded
            ? 'relative flex min-h-0 flex-1 touch-pan-y items-center justify-center p-2'
            : 'relative flex flex-1 touch-pan-y items-center justify-center p-4',
          { 'overflow-hidden': zoom() === 'fit', 'overflow-auto': zoom() !== 'fit' },
        ]}
        ref={setImageSurface}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <Show
          when={props.embedded}
          fallback={
            <>
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
            </>
          }
        >
          <button
            type='button'
            data-testid='image-previous-zone'
            class='absolute top-0 bottom-0 left-0 z-10 w-[30%] cursor-pointer'
            onClick={goPrevious}
            aria-label='Previous image'
          />
          <button
            type='button'
            data-testid='image-next-zone'
            class='absolute top-0 right-0 bottom-0 z-10 w-[30%] cursor-pointer'
            onClick={goNext}
            aria-label='Next image'
          />
        </Show>
        <Show when={responsiveImage.showSpinner()}>
          <LoaderCircle
            class={`absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/80 ${props.embedded ? 'h-6 w-6' : 'h-7 w-7'}`}
            aria-label='Loading image'
          />
        </Show>
        <Show when={responsiveImage.error()}>
          <div
            class={`z-20 flex flex-col items-center text-white ${props.embedded ? 'gap-2 text-sm' : 'gap-3'}`}
          >
            <p>Could not load image</p>
            <button
              type='button'
              class={`rounded-md border border-white/30 hover:bg-white/10 ${props.embedded ? 'px-2.5 py-1' : 'px-3 py-1.5'}`}
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
            class={[
              props.embedded
                ? 'pointer-events-none shrink-0'
                : 'pointer-events-none shrink-0 select-none',
              { invisible: responsiveImage.showSpinner() },
            ]}
            style={imgStyle()}
          />
        </Show>
      </div>
    </div>
  )
}
