import type { Accessor } from 'solid-js'
import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import {
  buildImageConfigUrl,
  buildImageUrl,
  buildMediaUrl,
  type MediaShareContext,
  type ResponsiveImageRequest,
} from './build-media-url'

type Dimensions = { width: number; height: number }

type Options = {
  path: Accessor<string>
  context: Accessor<MediaShareContext>
  viewport: Accessor<HTMLElement | undefined>
  zoom: Accessor<number | 'fit'>
  prefetchPaths: Accessor<string[]>
  onDisplayPath?: (path: string) => void
}

const configRequests = new Map<string, Promise<boolean>>()

function imageOptimizationEnabled(context: MediaShareContext): Promise<boolean> {
  const key = context ? `share:${context.token}` : 'admin'
  let request = configRequests.get(key)
  if (!request) {
    request = fetch(buildImageConfigUrl(context), { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return true
        return Boolean(((await response.json()) as { enabled?: boolean }).enabled)
      })
      .catch(() => true)
    configRequests.set(key, request)
  }
  return request
}

function offlineNow(): boolean {
  return new URLSearchParams(window.location.search).get('offline') === '1' || !navigator.onLine
}

export function createResponsiveImage(options: Options) {
  const [dimensions, setDimensions] = createSignal<Dimensions>({ width: 0, height: 0 })
  const [offline, setOffline] = createSignal(offlineNow())
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

  onMount(() => {
    const updateOffline = () => setOffline(offlineNow())
    window.addEventListener('online', updateOffline)
    window.addEventListener('offline', updateOffline)
    window.addEventListener('popstate', updateOffline)
    onCleanup(() => {
      window.removeEventListener('online', updateOffline)
      window.removeEventListener('offline', updateOffline)
      window.removeEventListener('popstate', updateOffline)
    })
  })

  createEffect(() => {
    const viewport = options.viewport()
    if (!viewport) return
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
    onCleanup(() => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    })
  })

  createEffect(() => {
    const context = options.context()
    let cancelled = false
    setEnabled(true)
    void imageOptimizationEnabled(context).then((value) => {
      if (!cancelled) setEnabled(value)
    })
    onCleanup(() => {
      cancelled = true
    })
  })

  createEffect(() => {
    const path = options.path()
    const { width, height } = dimensions()
    const zoom = options.zoom()
    if (path !== demandPath) {
      demandPath = path
      maximumDemand = { width: 0, height: 0, dpr: 0, scale: 0, priority: 'active' }
      setRequest(null)
      setForcedOriginal(false)
      setError(false)
      setLoadedPath('')
    }
    if (!path || width <= 0 || height <= 0 || offline() || !enabled()) return
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
      return
    }
    const frame = window.requestAnimationFrame(() => {
      maximumDemand = next
      setRequest(next)
    })
    onCleanup(() => window.cancelAnimationFrame(frame))
  })

  const originalUrl = createMemo(() => buildMediaUrl(options.path(), options.context()))
  const optimizedUrl = createMemo(() => {
    const value = request()
    return value ? buildImageUrl(options.path(), options.context(), value) : ''
  })
  const desiredSrc = createMemo(() => {
    const retry = retryNonce()
    if (!options.path()) return ''
    const url = offline() || !enabled() || forcedOriginal() ? originalUrl() : optimizedUrl()
    if (!url || retry === 0) return url
    return `${url}${url.includes('?') ? '&' : '?'}retry=${retry}`
  })
  createEffect(() => {
    const value = desiredSrc()
    if (!value) {
      setLoading(false)
      setShowSpinner(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setShowSpinner(false)
    setError(false)
    const spinnerTimer = window.setTimeout(() => {
      if (loading()) setShowSpinner(true)
    }, 1000)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      void image
        .decode()
        .catch(() => undefined)
        .then(() => {
          if (cancelled) return
          const path = options.path()
          if (loadedPath() !== path) options.onDisplayPath?.(path)
          setDisplayedSrc(value)
          setLoading(false)
          setShowSpinner(false)
          setError(false)
          setLoadedPath(path)
        })
    }
    image.onerror = () => {
      if (cancelled) return
      if (!forcedOriginal() && !offline() && enabled()) {
        setForcedOriginal(true)
        return
      }
      setLoading(false)
      setShowSpinner(false)
      setError(true)
    }
    image.src = value
    onCleanup(() => {
      cancelled = true
      window.clearTimeout(spinnerTimer)
      image.onload = null
      image.onerror = null
    })
  })

  function retry() {
    setError(false)
    setForcedOriginal(false)
    setLoadedPath('')
    setRetryNonce((value) => value + 1)
  }

  createEffect(() => {
    const path = options.path()
    const activeRequest = request()
    const paths = options.prefetchPaths().slice(0, 2)
    if (
      loadedPath() !== path ||
      !activeRequest ||
      offline() ||
      !enabled() ||
      forcedOriginal() ||
      paths.length === 0
    ) {
      return
    }
    const controllers = paths.map(() => new AbortController())
    paths.forEach((prefetchPath, index) => {
      const priority = index === 0 ? 'next' : 'prefetch'
      const url = buildImageUrl(prefetchPath, options.context(), { ...activeRequest, priority })
      void fetch(url, {
        credentials: 'include',
        signal: controllers[index]?.signal,
      }).catch(() => undefined)
    })
    onCleanup(() => controllers.forEach((controller) => controller.abort()))
  })

  return { src: displayedSrc, loading, showSpinner, error, retry, dimensions }
}
