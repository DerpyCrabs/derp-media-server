import { cn } from '@/lib/ui/cn'
import {
  domBinding,
  modelOwner,
  view,
  type JSX,
  controllerView,
  type ControllerModel,
} from 'effectweb'
import { randomId } from '@/lib/random-id'
import { createActivityId, sendActivity, type ActivityEvent } from '@/features/media-ai/activity'
import { MediaType, type FileItem } from '@/lib/files/types'
import Download from '@effectweb/lucide/icons/download'
import Maximize2 from '@effectweb/lucide/icons/maximize-2'
import RotateCw from '@effectweb/lucide/icons/rotate-cw'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import Shuffle from '@effectweb/lucide/icons/shuffle'
import X from '@effectweb/lucide/icons/x'
import ZoomIn from '@effectweb/lucide/icons/zoom-in'
import ZoomOut from '@effectweb/lucide/icons/zoom-out'
import { shuffleImages } from './image-order'
import { createResponsiveImage } from './responsive-image'
import { closeViewer, viewFile } from '@/lib/browser/url-state-actions'
export type ImageViewerPaneProps = {
  viewingPath: string
  allFiles: readonly FileItem[]
  directory?: string
  embedded?: boolean
  showClose?: boolean
  active?: boolean
  onNavigate?: (path: string) => void
  imageSeed?: string | null
  onImageSeedChange?: (seed: string | null, path: string) => void
  onClose?: () => void
}
const orderedImages = (props: ImageViewerPaneProps) => {
  const files = props.allFiles.filter((file) => file.type === MediaType.IMAGE)
  return props.imageSeed ? shuffleImages([...files], props.imageSeed) : files
}
function imageController(props: ImageViewerPaneProps) {
  const responsive = createResponsiveImage({
    path: props.viewingPath,
    zoom: 'fit',
    prefetchPaths: [],
  })
  const owner = modelOwner({
    props,
    zoom: 'fit' as number | 'fit',
    rotation: 0,
    image: responsive.source.model(),
  })
  const actions = {
    attach: (element: HTMLDivElement) => responsive.attach(element),
    dismiss: () => {
      const current = owner.read()
      if (current.props.onClose) current.props.onClose()
      else closeViewer()
      owner.patch({ zoom: 'fit', rotation: 0 })
    },
    move: (offset: number) => {
      const current = owner.read()
      const files = orderedImages(current.props)
      const index = files.findIndex((file) => file.path === current.props.viewingPath)
      if (index < 0) return
      const next = Math.max(0, Math.min(files.length - 1, index + offset))
      if (next === index) return
      const path = files[next]!.path
      if (current.props.onNavigate) current.props.onNavigate(path)
      else viewFile(path, current.props.directory || undefined, current.props.imageSeed ?? null)
    },
    shuffle: () => {
      const current = owner.read()
      const seed = randomId()
      const first = shuffleImages([...orderedImages(current.props)], seed)[0]
      if (first) current.props.onImageSeedChange?.(seed, first.path)
    },
    zoom: (delta: number) => {
      const current = owner.read().zoom
      owner.patch({
        zoom: Math.max(25, Math.min(400, (current === 'fit' ? 100 : current) + delta)),
      })
      select()
    },
    rotate: () => owner.patch({ rotation: (owner.read().rotation + 90) % 360 }),
    fit: () => {
      owner.patch({ zoom: 'fit', rotation: 0 })
      select()
    },
    retry: responsive.retry,
    download: () => {
      const path = owner.read().props.viewingPath
      const link = document.createElement('a')
      link.href = `/api/files/download?path=${encodeURIComponent(path)}`
      link.download = path.split(/[/\\]/).pop() || ''
      document.body.append(link)
      link.click()
      link.remove()
    },
  }
  const select = () => {
    const current = owner.read(),
      files = orderedImages(current.props)
    const index = files.findIndex((file) => file.path === current.props.viewingPath)
    responsive.select({
      path: current.props.viewingPath,
      zoom: current.zoom,
      prefetchPaths: index < 0 ? [] : files.slice(index + 1, index + 31).map((file) => file.path),
      onDisplayPath: () => {
        owner.patch({ zoom: 'fit', rotation: 0 })
        select()
      },
    })
  }
  owner.own(responsive)
  owner.own(responsive.source.subscribe((image) => owner.patch({ image })))
  select()
  return {
    source: owner.source,
    ...actions,
    receive: (next: ImageViewerPaneProps) => {
      owner.patch({ props: next })
      select()
    },
    lifetime: owner,
  }
}
type ImageModel = ControllerModel<typeof imageController>
const imageSurface = (element: HTMLDivElement, current: () => (element: HTMLDivElement) => void) =>
  current()(element)
const viewerBehavior = (element: HTMLDivElement, current: () => ImageModel) => {
  let wheelDelta = 0,
    pendingSteps = 0,
    lastTouchAt = 0,
    startX = 0
  let activePointer: number | null = null
  let resetTimer: ReturnType<typeof setTimeout> | undefined,
    flushTimer: ReturnType<typeof setTimeout> | undefined
  let activityPath = '',
    id = '',
    sequence = 0,
    last = Date.now(),
    active = false
  const report = () => {
    const model = current(),
      end = Date.now()
    if (!activityPath) return
    const visible =
      document.visibilityState === 'visible' &&
      model.props.active !== false &&
      model.image.load.request.kind !== 'loading' &&
      model.image.load.request.kind !== 'error'
    const event: ActivityEvent = {
      id,
      path: activityPath,
      kind: 'image',
      source: 'chosen',
      seq: sequence++,
      start: Math.max(last, end - 30000),
      end,
      seconds: active ? Math.min(5, (end - last) / 1000) : 0,
      duration: 0,
      hour: new Date(end).getHours(),
      completed: false,
      excluded: false,
    }
    sendActivity(event)
    last = end
    active = visible
  }
  const update = () => {
    const path = current().props.viewingPath
    if (path !== activityPath) {
      report()
      activityPath = path
      id = createActivityId()
      sequence = 0
      last = Date.now()
      active = false
      report()
    }
  }
  const keydown = (event: KeyboardEvent) => {
    if (
      current().props.active === false ||
      (event.target as HTMLElement | null)?.closest?.(
        'input, textarea, select, [contenteditable="true"]',
      )
    )
      return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopImmediatePropagation()
      current().actions.move(event.key === 'ArrowRight' ? 1 : -1)
    }
  }
  const flush = () => {
    if (flushTimer || pendingSteps === 0) return
    const steps = pendingSteps
    pendingSteps = 0
    current().actions.move(steps)
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      flush()
    }, 100)
  }
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || !window.matchMedia('(pointer: fine)').matches) return
    event.preventDefault()
    wheelDelta +=
      event.deltaY *
      (event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1)
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      wheelDelta = 0
    }, 150)
    if (Math.abs(wheelDelta) < 40) return
    pendingSteps += wheelDelta > 0 ? 1 : -1
    wheelDelta = 0
    flush()
  }
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || activePointer !== null) return
    try {
      element.setPointerCapture(event.pointerId)
    } catch {}
    activePointer = event.pointerId
    startX = event.clientX
  }
  const pointerUp = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return
    lastTouchAt = Date.now()
    if (activePointer !== event.pointerId) return
    activePointer = null
    const distance = event.clientX - startX
    const zoom = current().zoom
    if ((zoom === 'fit' || zoom === 100) && Math.abs(distance) >= 50)
      current().actions.move(distance < 0 ? 1 : -1)
  }
  const pointerCancel = (event: PointerEvent) => {
    if (activePointer === event.pointerId) activePointer = null
  }
  const zoneClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-image-direction]')
    if (!target || current().props.embedded) return
    if (Date.now() - lastTouchAt < 700 || !window.matchMedia('(pointer: fine)').matches) return
    current().actions.move(target.dataset.imageDirection === 'next' ? 1 : -1)
  }
  window.addEventListener('keydown', keydown, true)
  element.addEventListener('wheel', wheel, { passive: false })
  element.addEventListener('pointerdown', pointerDown)
  element.addEventListener('pointerup', pointerUp)
  element.addEventListener('pointercancel', pointerCancel)
  element.addEventListener('click', zoneClick)
  document.addEventListener('visibilitychange', report)
  window.addEventListener('pagehide', report)
  const timer = setInterval(report, 5000)
  update()
  return {
    update,
    dispose: () => {
      report()
      clearInterval(timer)
      clearTimeout(resetTimer)
      clearTimeout(flushTimer)
      window.removeEventListener('keydown', keydown, true)
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('pointerdown', pointerDown)
      element.removeEventListener('pointerup', pointerUp)
      element.removeEventListener('pointercancel', pointerCancel)
      element.removeEventListener('click', zoneClick)
      document.removeEventListener('visibilitychange', report)
      window.removeEventListener('pagehide', report)
    },
  }
}
export const ImageViewerPane = controllerView(
  { controller: imageController },
  view((model) => {
    const props = model.props,
      actions = model.actions
    const images = orderedImages(props),
      index = images.findIndex((file) => file.path === props.viewingPath)
    const fileName = () => props.viewingPath.split(/[/\\]/).pop() || ''
    const totalImages = () => images.length
    const currentImageNumber = () => (index < 0 ? 1 : index + 1)
    const imageSeed = () => props.imageSeed
    const zoom = model.zoom
    const handleClose = actions.dismiss,
      reshuffleImages = actions.shuffle,
      handleZoomOut = () => actions.zoom(-25),
      handleZoomIn = () => actions.zoom(25),
      handleFitToScreen = actions.fit,
      handleRotate = actions.rotate,
      handleDownload = actions.download
    const goPrevious = () => actions.move(-1),
      goNext = () => actions.move(1)
    const responsiveImage = {
      src: () => model.image.load.displayed?.src ?? '',
      showSpinner: () =>
        model.image.load.request.kind === 'loading' && model.image.load.request.spinner,
      error: () => model.image.load.request.kind === 'error',
      retry: actions.retry,
    }
    const quarterTurn = model.rotation % 180 !== 0,
      dimensions = model.image.dimensions
    const style: JSX.CSSProperties =
      model.zoom === 'fit'
        ? {
            width: quarterTurn && dimensions.height > 0 ? `${dimensions.height}px` : '100%',
            height: quarterTurn && dimensions.width > 0 ? `${dimensions.width}px` : '100%',
            'object-fit': 'contain',
          }
        : {
            'max-width': '100%',
            'max-height': '100%',
            width: 'auto',
            height: 'auto',
            'object-fit': 'none',
          }
    const imgStyle = () => ({
      ...style,
      transform: `scale(${model.zoom === 'fit' ? 1 : model.zoom / 100}) rotate(${model.rotation}deg)`,
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
        use={domBinding(model, viewerBehavior)}
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
          {totalImages() > 0 ? (
            <div class={props.embedded ? 'shrink-0' : 'hidden shrink-0 px-3 sm:block'}>
              <span class='text-sm font-medium text-white'>
                {currentImageNumber()} of {totalImages()}
              </span>
            </div>
          ) : null}
          <div class='flex shrink-0 items-center justify-end gap-0.5 sm:gap-2'>
            {props.onImageSeedChange ? (
              <button
                type='button'
                title='Shuffle images'
                aria-label='Shuffle images'
                class={cn(
                  props.embedded
                    ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                    : 'inline-flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10',
                  { 'bg-white/20': Boolean(imageSeed()) },
                )}
                disabled={totalImages() === 0}
                onClick={reshuffleImages}
              >
                <Shuffle class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
              </button>
            ) : null}
            <button
              type='button'
              class={
                props.embedded
                  ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                  : 'inline-flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
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
              {zoom === 'fit' ? 'Fit' : `${zoom}%`}
            </span>
            <button
              type='button'
              class={
                props.embedded
                  ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                  : 'inline-flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
              }
              onClick={handleZoomIn}
            >
              <ZoomIn
                class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'}
                size={20}
                stroke-width={2}
              />
            </button>
            <button
              type='button'
              title='Fit to screen'
              class={
                props.embedded
                  ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                  : 'inline-flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
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
                  : 'inline-flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
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
                  : 'inline-flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
              }
              onClick={handleDownload}
            >
              <Download
                class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'}
                size={20}
                stroke-width={2}
              />
            </button>
            {props.showClose !== false ? (
              <button
                type='button'
                title='Close'
                aria-label='Close'
                class={
                  props.embedded
                    ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                    : 'inline-flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
                }
                onClick={handleClose}
              >
                <X class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'} size={20} stroke-width={2} />
              </button>
            ) : null}
          </div>
        </div>

        <div
          data-testid={props.embedded ? 'workspace-image-surface' : 'image-gesture-surface'}
          class={cn(
            props.embedded
              ? 'relative flex min-h-0 flex-1 touch-pan-y items-center justify-center'
              : 'relative flex flex-1 touch-pan-y items-center justify-center p-4',
            { 'overflow-hidden': zoom === 'fit', 'overflow-auto': zoom !== 'fit' },
          )}
          use={domBinding(actions.attach, imageSurface)}
        >
          {props.embedded ? (
            <>
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
            </>
          ) : (
            <>
              <div
                data-testid='image-previous-zone'
                class='absolute top-0 bottom-0 left-0 z-10 hidden w-[30%] cursor-pointer [@media(pointer:fine)]:block'
                data-image-direction='previous'
                role='presentation'
              />
              <div
                data-testid='image-next-zone'
                class='absolute top-0 right-0 bottom-0 z-10 hidden w-[30%] cursor-pointer [@media(pointer:fine)]:block'
                data-image-direction='next'
                role='presentation'
              />
            </>
          )}
          {responsiveImage.showSpinner() ? (
            <LoaderCircle
              class={`absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/80 ${props.embedded ? 'h-6 w-6' : 'h-7 w-7'}`}
              aria-label='Loading image'
            />
          ) : null}
          {responsiveImage.error() ? (
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
          ) : null}
          {responsiveImage.src() && !responsiveImage.error() ? (
            <img
              src={responsiveImage.src()}
              alt={fileName()}
              class={cn(
                props.embedded
                  ? 'pointer-events-none shrink-0'
                  : 'pointer-events-none shrink-0 select-none',
                { invisible: responsiveImage.showSpinner() },
              )}
              style={imgStyle()}
            />
          ) : null}
        </div>
      </div>
    )
  }),
)
