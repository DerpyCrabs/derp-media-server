import { LazyImageEditor } from '@/features/image-editor/LazyImageEditor'
import Pencil from '@effectweb/lucide/icons/pencil'
import { cn } from '@/lib/ui/cn'
import { list, domBinding, modelOwner, view, controllerView, type ControllerModel } from 'effectweb'
import { randomId } from '@/lib/random-id'
import { createActivityId, sendActivity, type ActivityEvent } from '@/features/media-ai/activity'
import { MediaType, type FileItem } from '@/lib/files/types'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import { Effect } from 'effect'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { imageOutput } from './image-output'
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
  allowEditing?: boolean
  editableFolders?: readonly string[]
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
    editing: false,
    copying: false,
    slideshow: 'off' as 'off' | 'playing' | 'paused' | 'ended',
    slideSeconds: 5,
    slideLoop: false,
    outputMessage: '',
    menu: null as HTMLElement | null,
    image: responsive.source.model(),
  })
  const actions = {
    toggleSlideshow: () => {
      const current = owner.read()
      if (orderedImages(current.props).length < 2) return
      if (current.slideshow === 'playing') owner.patch({ slideshow: 'paused', menu: null })
      else {
        owner.patch({ slideshow: 'playing', zoom: 'fit', menu: null, outputMessage: '' })
        select()
        if (current.slideshow === 'ended') {
          const index = orderedImages(current.props).findIndex(
            (file) => file.path === current.props.viewingPath,
          )
          if (index > 0) actions.move(-index)
        }
      }
    },
    stopSlideshow: () => owner.patch({ slideshow: 'off' }),
    slideSeconds: (slideSeconds: number) => {
      if ([2, 5, 10, 15, 30].includes(slideSeconds)) owner.patch({ slideSeconds })
    },
    slideLoop: (slideLoop: boolean) => owner.patch({ slideLoop }),
    advanceSlide: () => {
      const current = owner.read()
      if (current.slideshow !== 'playing') return
      const files = orderedImages(current.props)
      const index = files.findIndex((file) => file.path === current.props.viewingPath)
      if (index < 0 || files.length < 2 || (index === files.length - 1 && !current.slideLoop)) {
        owner.patch({ slideshow: 'ended' })
        return
      }
      actions.move(index === files.length - 1 ? -index : 1)
    },
    menu: (menu: HTMLElement | null) => owner.patch({ menu }),
    clearMessage: () => owner.patch({ outputMessage: '' }),
    copy: () => {
      const current = owner.read()
      if (current.copying) return
      owner.patch({ menu: null, outputMessage: '' })
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        owner.patch({
          outputMessage:
            'Copying images requires HTTPS or the desktop client. You can download the image instead.',
        })
        return
      }
      const abort = new AbortController()
      owner.patch({ copying: true })
      const blob = imageOutput(current.props.viewingPath, current.rotation, abort.signal).then(
        (result) => result.blob,
      )
      // Start clipboard access during the user gesture, including on Safari.
      let copied: Promise<void>
      try {
        copied = navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      } catch (error) {
        copied = Promise.reject(error)
      }
      void blob.catch(() => {})
      owner.run(
        'copy',
        Effect.tryPromise(() => copied).pipe(
          Effect.tap(() => Effect.sync(() => owner.patch({ outputMessage: 'Image copied.' }))),
          Effect.catch(() =>
            Effect.sync(() =>
              owner.patch({
                outputMessage:
                  'Could not copy the image. Check clipboard permission, or download the original.',
              }),
            ),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              abort.abort()
              owner.patch({ copying: false })
            }),
          ),
        ),
        'drop',
      )
    },
    edit: () => owner.patch({ editing: true, slideshow: 'off' }),
    closeEdit: () => owner.patch({ editing: false }),
    savedCopy: (path: string) => {
      owner.patch({ editing: false })
      const current = owner.read()
      if (current.props.onNavigate) current.props.onNavigate(path)
      else viewFile(path, current.props.directory || undefined)
    },
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
        ...(owner.read().slideshow === 'playing' ? { slideshow: 'paused' as const } : {}),
        zoom: Math.max(25, Math.min(400, (current === 'fit' ? 100 : current) + delta)),
      })
      select()
    },
    actualSize: () => {
      owner.patch({
        zoom: 100,
        ...(owner.read().slideshow === 'playing' ? { slideshow: 'paused' as const } : {}),
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
      owner.patch({ menu: null })
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
  owner.own(
    responsive.source.subscribe((image) =>
      owner.patch({
        image,
        ...(image.load.request.kind === 'error' && owner.read().slideshow === 'playing'
          ? {
              slideshow: 'paused' as const,
              outputMessage: 'Slideshow paused: this image could not be loaded.',
            }
          : {}),
      }),
    ),
  )
  select()
  return {
    source: owner.source,
    ...actions,
    receive: (next: ImageViewerPaneProps) => {
      if (next.viewingPath !== owner.read().props.viewingPath) {
        owner.cancel('copy')
        owner.patch({ menu: null, outputMessage: '' })
      }
      owner.patch({
        props: next,
        editing: next.viewingPath === owner.read().props.viewingPath && owner.read().editing,
      })
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
  let pan: {
    id: number
    x: number
    y: number
    left: number
    top: number
    surface: HTMLElement
  } | null = null
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
  let slideTimer: ReturnType<typeof setTimeout> | undefined,
    slideKey = ''
  const slideReady = () => {
    const model = current()
    const modal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]')
    return (
      model.slideshow === 'playing' &&
      model.props.active !== false &&
      document.visibilityState === 'visible' &&
      !model.menu &&
      !model.editing &&
      (!modal || modal === element || element.contains(modal)) &&
      model.image.load.request.kind === 'idle' &&
      model.image.load.displayed?.path === model.props.viewingPath
    )
  }
  const updateSlideshow = () => {
    const model = current()
    const key = slideReady()
      ? `${model.props.viewingPath}:${model.slideSeconds}:${model.slideLoop}`
      : ''
    if (key === slideKey) return
    clearTimeout(slideTimer)
    slideTimer = undefined
    slideKey = key
    if (key)
      slideTimer = setTimeout(() => {
        slideTimer = undefined
        slideKey = ''
        if (slideReady()) current().actions.advanceSlide()
      }, model.slideSeconds * 1000)
  }
  const update = () => {
    updateSlideshow()
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
    if (event.defaultPrevented || current().menu) return
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase()
      if (key === 'c' && !window.getSelection()?.toString()) {
        event.preventDefault()
        event.stopImmediatePropagation()
        current().actions.copy()
      }
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (
      event.key.toLowerCase() === 's' ||
      (event.key === 'Escape' && current().slideshow !== 'off')
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') current().actions.stopSlideshow()
      else current().actions.toggleSlideshow()
      return
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      event.stopImmediatePropagation()
      current().actions.move(event.key === 'PageDown' ? 1 : -1)
      return
    }
    if (event.key.startsWith('Arrow') && current().zoom !== 'fit') {
      const surface = element.querySelector<HTMLElement>('[data-testid$=surface]')
      if (surface) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const step = event.shiftKey ? 160 : 60
        surface.scrollBy({
          left: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
          top: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
          behavior: 'instant',
        })
      }
      return
    }
    const action =
      event.key === '+' || event.key === '='
        ? () => current().actions.zoom(25)
        : event.key === '-'
          ? () => current().actions.zoom(-25)
          : event.key === '0'
            ? current().actions.fit
            : event.key === '1'
              ? current().actions.actualSize
              : event.key.toLowerCase() === 'r'
                ? current().actions.rotate
                : undefined
    if (action) {
      event.preventDefault()
      event.stopImmediatePropagation()
      action()
      return
    }
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
    if (!(event.target instanceof Element) || !event.target.closest('[data-testid$=surface]'))
      return
    if (event.ctrlKey) {
      event.preventDefault()
      if (event.deltaY) current().actions.zoom(event.deltaY < 0 ? 25 : -25)
      return
    }
    if (current().zoom !== 'fit' || !window.matchMedia('(pointer: fine)').matches) return
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
    const surface = (event.target as Element).closest<HTMLElement>('[data-testid$=surface]')
    if (current().zoom !== 'fit' && surface && event.button === 0) {
      event.preventDefault()
      surface.setPointerCapture(event.pointerId)
      pan = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: surface.scrollLeft,
        top: surface.scrollTop,
        surface,
      }
      return
    }
    if (event.pointerType !== 'touch' || activePointer !== null) return
    try {
      element.setPointerCapture(event.pointerId)
    } catch {}
    activePointer = event.pointerId
    startX = event.clientX
  }
  const pointerMove = (event: PointerEvent) => {
    if (!pan || pan.id !== event.pointerId) return
    pan.surface.scrollLeft = pan.left + pan.x - event.clientX
    pan.surface.scrollTop = pan.top + pan.y - event.clientY
  }
  const pointerUp = (event: PointerEvent) => {
    if (pan?.id === event.pointerId) {
      pan = null
      return
    }
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
    if (pan?.id === event.pointerId) pan = null
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
  element.addEventListener('pointermove', pointerMove)
  element.addEventListener('pointerup', pointerUp)
  element.addEventListener('pointercancel', pointerCancel)
  element.addEventListener('click', zoneClick)
  document.addEventListener('visibilitychange', report)
  document.addEventListener('visibilitychange', updateSlideshow)
  document.addEventListener('focusin', updateSlideshow)
  window.addEventListener('pagehide', report)
  const timer = setInterval(report, 5000)
  update()
  return {
    update,
    dispose: () => {
      report()
      clearInterval(timer)
      clearTimeout(slideTimer)
      clearTimeout(resetTimer)
      clearTimeout(flushTimer)
      window.removeEventListener('keydown', keydown, true)
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('pointerdown', pointerDown)
      element.removeEventListener('pointermove', pointerMove)
      element.removeEventListener('pointerup', pointerUp)
      element.removeEventListener('pointercancel', pointerCancel)
      element.removeEventListener('click', zoneClick)
      document.removeEventListener('visibilitychange', report)
      document.removeEventListener('visibilitychange', updateSlideshow)
      document.removeEventListener('focusin', updateSlideshow)
      window.removeEventListener('pagehide', report)
    },
  }
}
export const ImageViewerPane = controllerView(
  { controller: imageController },
  view((model) => {
    if (model.editing)
      return (
        <LazyImageEditor
          path={model.props.viewingPath}
          editableFolders={model.props.editableFolders ?? []}
          embedded={model.props.embedded}
          onClose={model.actions.closeEdit}
          onSaved={model.actions.savedCopy}
        />
      )
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
      handleRotate = actions.rotate
    const goPrevious = () => actions.move(-1),
      goNext = () => actions.move(1)
    const responsiveImage = {
      src: () => model.image.load.displayed?.src ?? '',
      showSpinner: () =>
        model.image.load.request.kind === 'loading' && model.image.load.request.spinner,
      error: () => model.image.load.request.kind === 'error',
      retry: actions.retry,
    }
    const quarterTurn = model.rotation % 180 !== 0
    const pixels = model.image.pixels
    const bounds = model.image.dimensions
    const rotatedWidth = quarterTurn ? pixels.height : pixels.width
    const rotatedHeight = quarterTurn ? pixels.width : pixels.height
    const scale =
      zoom === 'fit'
        ? Math.min(bounds.width / (rotatedWidth || 1), bounds.height / (rotatedHeight || 1))
        : zoom / 100
    const imageWidth = pixels.width * scale
    const imageHeight = pixels.height * scale
    const canvasStyle = { width: `${rotatedWidth * scale}px`, height: `${rotatedHeight * scale}px` }
    const imgStyle = () => ({
      width: `${imageWidth}px`,
      height: `${imageHeight}px`,
      'max-width': 'none',
      transform: `translate(-50%, -50%) rotate(${model.rotation}deg)`,
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
            {props.allowEditing !== false ? (
              <button
                type='button'
                aria-label='Edit image'
                title='Edit image'
                class={
                  props.embedded
                    ? 'inline-flex size-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                    : 'inline-flex size-8 sm:size-11 items-center justify-center rounded-md text-white hover:bg-white/10'
                }
                onClick={actions.edit}
              >
                <Pencil size={props.embedded ? 14 : 18} />
              </button>
            ) : null}
            {props.onImageSeedChange ? (
              <button
                type='button'
                title='Shuffle images'
                aria-label='Shuffle images'
                class={cn(
                  props.embedded
                    ? 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white hover:bg-white/10'
                    : 'inline-flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10',
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
                  : 'inline-flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
              }
              aria-label='Zoom out'
              title='Zoom out'
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
                  : 'inline-flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
              }
              aria-label='Zoom in'
              title='Zoom in'
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
                  : 'inline-flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
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
                  : 'inline-flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
              }
              aria-label='Rotate clockwise'
              title='Rotate clockwise'
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
                  : 'inline-flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
              }
              aria-label='Image actions'
              title='Image actions'
              aria-haspopup='menu'
              aria-expanded={Boolean(model.menu)}
              onClick={(event) => actions.menu(event.currentTarget)}
            >
              <Ellipsis
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
                    : 'inline-flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-md text-white hover:bg-white/10'
                }
                onClick={handleClose}
              >
                <X class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'} size={20} stroke-width={2} />
              </button>
            ) : null}
          </div>
        </div>

        <FloatingContextMenu
          open={Boolean(model.menu)}
          anchorRef={model.menu}
          onDismiss={() => actions.menu(null)}
          role='menu'
          class='w-56'
        >
          {images.length > 1 ? (
            <button
              role='menuitem'
              class='flex min-h-10 w-full items-center justify-between rounded px-3 text-sm hover:bg-muted'
              onClick={actions.toggleSlideshow}
            >
              {model.slideshow === 'playing'
                ? 'Pause slideshow'
                : model.slideshow === 'paused'
                  ? 'Resume slideshow'
                  : 'Start slideshow'}
              <span class='text-xs text-muted-foreground'>S</span>
            </button>
          ) : null}
          <button
            role='menuitem'
            disabled={model.copying}
            class='flex min-h-10 w-full items-center justify-between rounded px-3 text-sm hover:bg-muted disabled:opacity-50'
            onClick={actions.copy}
          >
            {model.copying ? 'Copying…' : 'Copy image'}
            <span class='text-xs text-muted-foreground'>Ctrl+C</span>
          </button>
          <button
            role='menuitem'
            class='min-h-10 w-full rounded px-3 text-left text-sm hover:bg-muted'
            onClick={actions.download}
          >
            Download image
          </button>
        </FloatingContextMenu>
        {model.slideshow !== 'off' ? (
          <div
            role='group'
            aria-label='Slideshow controls'
            class='flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-white/10 bg-black/90 px-2 py-1.5 text-xs text-white'
          >
            <button
              type='button'
              class='rounded px-2 py-1 hover:bg-white/15'
              onClick={actions.toggleSlideshow}
            >
              {model.slideshow === 'playing'
                ? 'Pause slideshow'
                : model.slideshow === 'ended'
                  ? 'Replay slideshow'
                  : 'Resume slideshow'}
            </button>
            <label class='flex items-center gap-1'>
              Interval{' '}
              <select
                aria-label='Slideshow interval'
                class='rounded bg-neutral-800 px-1 py-1 text-white'
                value={String(model.slideSeconds)}
                onChange={(event) => actions.slideSeconds(Number(event.currentTarget.value))}
              >
                {list([2, 5, 10, 15, 30], (seconds) => (
                  <option value={String(seconds)}>{seconds}s</option>
                ))}
              </select>
            </label>
            <label class='flex items-center gap-1'>
              <input
                type='checkbox'
                checked={model.slideLoop}
                onChange={(event) => actions.slideLoop(event.currentTarget.checked)}
              />
              Loop
            </label>
            <button
              type='button'
              aria-label='Stop slideshow'
              title='Stop slideshow (Esc)'
              class='rounded p-1 hover:bg-white/15'
              onClick={actions.stopSlideshow}
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
        {model.copying || model.outputMessage ? (
          <div
            role='status'
            class='flex items-center justify-between gap-2 bg-black/70 px-3 py-2 text-sm text-white'
          >
            <span>{model.copying ? 'Copying image…' : model.outputMessage}</span>
            {!model.copying ? (
              <button type='button' aria-label='Dismiss message' onClick={actions.clearMessage}>
                <X size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          data-testid={props.embedded ? 'workspace-image-surface' : 'image-gesture-surface'}
          class={cn(
            props.embedded ? 'relative flex min-h-0 flex-1' : 'relative flex min-h-0 flex-1 p-4',
            {
              'overflow-hidden touch-pan-y': zoom === 'fit',
              'overflow-auto touch-none cursor-grab': zoom !== 'fit',
            },
          )}
          use={domBinding(actions.attach, imageSurface)}
        >
          {zoom !== 'fit' ? null : props.embedded ? (
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
            <div class='relative m-auto shrink-0' style={canvasStyle}>
              <img
                src={responsiveImage.src()}
                alt={fileName()}
                class={cn(
                  props.embedded
                    ? 'pointer-events-none absolute left-1/2 top-1/2 select-none'
                    : 'pointer-events-none absolute left-1/2 top-1/2 select-none',
                  { invisible: responsiveImage.showSpinner() },
                )}
                style={imgStyle()}
              />
            </div>
          ) : null}
        </div>
      </div>
    )
  }),
)
