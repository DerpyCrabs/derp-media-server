import type { Accessor } from 'solid-js'
import { createEffect, createMemo, createSignal, onSettled, untrack } from 'solid-js'
import {
  buildImageConfigUrl,
  buildImageUrl,
  buildMediaUrl,
  type ResponsiveImageRequest,
} from '@/lib/media/build-media-url'

type Dimensions = { width: number; height: number }

type Options = {
  path: Accessor<string>
  viewport: Accessor<HTMLElement | undefined>
  zoom: Accessor<number | 'fit'>
  prefetchPaths: Accessor<string[]>
  onDisplayPath?: (path: string) => void
}

const configRequests = new Map<string, Promise<boolean>>()

function imageOptimizationEnabled(): Promise<boolean> {
  let request = configRequests.get('admin')
  if (!request) {
    request = fetch(buildImageConfigUrl(), { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return true
        return Boolean(((await response.json()) as { enabled?: boolean }).enabled)
      })
      .catch(() => true)
    configRequests.set('admin', request)
  }
  return request
}

export function createResponsiveImage(options: Options) {
  const [dimensions, setDimensions] = createSignal<Dimensions>({ width: 0, height: 0 })
  const [enabled, setEnabled] = createSignal(true)
  const [request, setRequest] = createSignal<ResponsiveImageRequest | null>(null)
  const [forcedOriginal, setForcedOriginal] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [showSpinner, setShowSpinner] = createSignal(false)
  const [error, setError] = createSignal(false)
  const [loadedPath, setLoadedPath] = createSignal('')
  const [displayedSrc, setDisplayedSrc] = createSignal('')
  const [retryNonce, setRetryNonce] = createSignal(0)
  let maximumDemand: ResponsiveImageRequest = {
    width: 0,
    height: 0,
    dpr: 0,
    scale: 0,
    priority: 'active',
  }
  let demandPath = ''

  createEffect(
    () => options.viewport(),
    (viewport) => {
      if (!viewport) return undefined
      const update = () => {
        const bounds = viewport.getBoundingClientRect()
        const style = getComputedStyle(viewport)
        setDimensions({
          width: Math.max(
            0,
            bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          ),
          height: Math.max(
            0,
            bounds.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
          ),
        })
      }
      update()
      const observer = new ResizeObserver(update)
      observer.observe(viewport)
      window.addEventListener('resize', update)
      // eslint-disable-next-line solid/reactivity
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', update)
      }
    },
  )

  onSettled(() => {
    let cancelled = false
    setEnabled(true)
    void imageOptimizationEnabled().then((value) => {
      if (!cancelled) setEnabled(value)
    })
    return () => {
      cancelled = true
    }
  })

  createEffect(
    () => {
      const { width, height } = dimensions()
      return { path: options.path(), width, height, zoom: options.zoom(), enabled: enabled() }
    },
    ({ path, width, height, zoom, enabled: isEnabled }) => {
      if (path !== demandPath) {
        demandPath = path
        maximumDemand = { width: 0, height: 0, dpr: 0, scale: 0, priority: 'active' }
        setRequest(null)
        setForcedOriginal(false)
        setError(false)
        setLoadedPath('')
      }
      if (!path || width <= 0 || height <= 0 || !isEnabled) return undefined
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const scale = zoom === 'fit' ? 1 : zoom / 100
      const next = {
        width: Math.max(maximumDemand.width, width),
        height: Math.max(maximumDemand.height, height),
        dpr: Math.max(maximumDemand.dpr, dpr),
        scale: Math.max(maximumDemand.scale, scale),
        priority: 'active' as const,
      }
      if (
        next.width === maximumDemand.width &&
        next.height === maximumDemand.height &&
        next.dpr === maximumDemand.dpr &&
        next.scale === maximumDemand.scale
      ) {
        return undefined
      }
      const frame = window.requestAnimationFrame(() => {
        maximumDemand = next
        setRequest(next)
      })
      // eslint-disable-next-line solid/reactivity
      return () => window.cancelAnimationFrame(frame)
    },
  )

  const originalUrl = createMemo(() => buildMediaUrl(options.path()))
  const optimizedUrl = createMemo(() => {
    const value = request()
    return value ? buildImageUrl(options.path(), value) : ''
  })
  const desiredSrc = createMemo(() => {
    const retry = retryNonce()
    if (!options.path()) return ''
    const url = !enabled() || forcedOriginal() ? originalUrl() : optimizedUrl()
    if (!url || retry === 0) return url
    return `${url}${url.includes('?') ? '&' : '?'}retry=${retry}`
  })
  createEffect(
    () => desiredSrc(),
    (value) => {
      if (!value) {
        setLoading(false)
        setShowSpinner(false)
        return undefined
      }
      let cancelled = false
      setLoading(true)
      setShowSpinner(false)
      setError(false)
      const spinnerTimer = window.setTimeout(() => {
        if (untrack(loading)) setShowSpinner(true)
      }, 1000)
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => {
        void image
          .decode()
          .catch(() => undefined)
          .then(() =>
            untrack(() => {
              if (cancelled) return
              const path = options.path()
              if (loadedPath() !== path) options.onDisplayPath?.(path)
              setDisplayedSrc(value)
              setLoading(false)
              setShowSpinner(false)
              setError(false)
              setLoadedPath(path)
            }),
          )
      }
      image.onerror = () => {
        if (cancelled) return
        if (!forcedOriginal() && enabled()) {
          setForcedOriginal(true)
          return
        }
        setLoading(false)
        setShowSpinner(false)
        setError(true)
      }
      image.src = value
      // eslint-disable-next-line solid/reactivity
      return () => {
        cancelled = true
        window.clearTimeout(spinnerTimer)
        image.onload = null
        image.onerror = null
      }
    },
  )

  function retry() {
    setError(false)
    setForcedOriginal(false)
    setLoadedPath('')
    setRetryNonce((value) => value + 1)
  }

  createEffect(
    () => {
      const path = options.path()
      const activeRequest = request()
      const paths = options.prefetchPaths().slice(0, 2)
      return loadedPath() === path &&
        activeRequest &&
        enabled() &&
        !forcedOriginal() &&
        paths.length > 0
        ? { activeRequest, paths }
        : null
    },
    (prefetch) => {
      if (!prefetch) return undefined
      const controllers = prefetch.paths.map(() => new AbortController())
      prefetch.paths.forEach((prefetchPath, index) => {
        const priority = index === 0 ? 'next' : 'prefetch'
        const url = buildImageUrl(prefetchPath, { ...prefetch.activeRequest, priority })
        void fetch(url, {
          credentials: 'include',
          signal: controllers[index]?.signal,
        }).catch(() => undefined)
      })
      // eslint-disable-next-line solid/reactivity
      return () => controllers.forEach((controller) => controller.abort())
    },
  )

  return { src: displayedSrc, loading, showSpinner, error, retry, dimensions }
}
