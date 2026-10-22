import { Schema } from 'effect'
import { Effect } from 'effect'
import { available, modelOwner } from 'effectweb'
import { createMediaWarmup, observeMediaVisibility } from '@/lib/media/media-warmup'
import { queryCache } from '@/lib/api/cache'
import { apiSchemaEffect } from '@/lib/api/client'
import {
  buildImageConfigUrl,
  buildImageUrl,
  buildMediaUrl,
  type ResponsiveImageRequest,
} from '@/lib/media/build-media-url'
import { observeQuery, query } from '@effectweb/query'

export type ImageLoadState = {
  displayed: { src: string; path: string } | null
  request: { kind: 'idle' } | { kind: 'loading'; spinner: boolean } | { kind: 'error' }
}

export type ImageLoadEvent =
  | { kind: 'reset' }
  | { kind: 'start' }
  | { kind: 'show-spinner' }
  | { kind: 'display'; src: string; path: string }
  | { kind: 'error' }

export function reduceImageLoadState(state: ImageLoadState, event: ImageLoadEvent): ImageLoadState {
  if (event.kind === 'reset') return { ...state, request: { kind: 'idle' } }
  if (event.kind === 'start') return { ...state, request: { kind: 'loading', spinner: false } }
  if (event.kind === 'show-spinner')
    return state.request.kind === 'loading'
      ? { ...state, request: { kind: 'loading', spinner: true } }
      : state
  if (event.kind === 'display')
    return { displayed: { src: event.src, path: event.path }, request: { kind: 'idle' } }
  return { ...state, request: { kind: 'error' } }
}

type Options = {
  path: string
  zoom: number | 'fit'
  prefetchPaths: readonly string[]
  onDisplayPath?: (path: string) => void
}
const configQuery = query({
  name: 'image-config',
  load: () =>
    apiSchemaEffect(
      Schema.Struct({ enabled: Schema.optional(Schema.Boolean) }),
      buildImageConfigUrl(),
    ),
})
const loadSlot = 'responsive-image-load'
const spinnerSlot = 'responsive-image-spinner'
const prefetchSlot = 'responsive-image-prefetch'
export function createResponsiveImage(initial: Options) {
  let options = initial
  let demandPath = '',
    requested = '',
    prefetchKey = ''
  let forcedOriginal = false,
    enabled = true,
    visible = false,
    retryNonce = 0
  let maximum: ResponsiveImageRequest = {
    width: 0,
    height: 0,
    dpr: 0,
    scale: 0,
    priority: 'active',
  }
  let unobserve: (() => void) | undefined
  const owner = modelOwner({
    load: { displayed: null, request: { kind: 'idle' } } as ImageLoadState,
    dimensions: { width: 0, height: 0 },
  })
  const warmup = owner.own(createMediaWarmup())
  const dispatch = (event: ImageLoadEvent) =>
    owner.patch({ load: reduceImageLoadState(owner.read().load, event) })
  const prefetch = () => {
    const model = owner.read()
    const active =
      visible &&
      model.load.displayed?.path === options.path &&
      enabled &&
      !forcedOriginal &&
      maximum.width > 0 &&
      maximum.height > 0
    const paths = active ? options.prefetchPaths : []
    const nextKey = JSON.stringify([paths.slice(0, 2), maximum])
    if (nextKey !== prefetchKey) {
      prefetchKey = nextKey
      owner.run(
        prefetchSlot,
        Effect.forEach(
          paths.slice(0, 2),
          (path) =>
            Effect.tryPromise((signal) =>
              fetch(buildImageUrl(path, { ...maximum, priority: 'next' }), {
                credentials: 'include',
                signal,
              }),
            ).pipe(Effect.ignore),
          { concurrency: 2 },
        ),
        'replace',
      )
    }
    warmup.select(
      paths
        .slice(2, 30)
        .map((path) =>
          buildImageUrl(path, { ...maximum, scale: 1, priority: 'prefetch' }).replace(
            '/api/image/',
            '/api/warm/image/',
          ),
        ),
    )
  }
  const update = () => {
    const { width, height } = owner.read().dimensions
    if (options.path !== demandPath) {
      demandPath = options.path
      maximum = { width: 0, height: 0, dpr: 0, scale: 0, priority: 'active' }
      forcedOriginal = false
      retryNonce = 0
      dispatch({ kind: 'reset' })
    }
    if (enabled && width > 0 && height > 0)
      maximum = {
        width: Math.max(maximum.width, width),
        height: Math.max(maximum.height, height),
        dpr: Math.max(maximum.dpr, Math.min(window.devicePixelRatio || 1, 2)),
        scale: Math.max(maximum.scale, options.zoom === 'fit' ? 1 : options.zoom / 100),
        priority: 'active',
      }
    let src = !options.path
      ? ''
      : !enabled || forcedOriginal
        ? buildMediaUrl(options.path)
        : maximum.width > 0 && maximum.height > 0
          ? buildImageUrl(options.path, maximum)
          : ''
    if (src && retryNonce) src += `${src.includes('?') ? '&' : '?'}retry=${retryNonce}`
    prefetch()
    if (src === requested) return
    requested = src
    owner.cancel(loadSlot)
    owner.cancel(spinnerSlot)
    if (!src) {
      dispatch({ kind: 'reset' })
      return
    }
    const path = options.path
    dispatch({ kind: 'start' })
    owner.run(
      spinnerSlot,
      Effect.sleep(1000).pipe(
        Effect.andThen(Effect.sync(() => dispatch({ kind: 'show-spinner' }))),
      ),
      'replace',
    )
    owner.run(
      loadSlot,
      Effect.callback<HTMLImageElement, Error>((resume) => {
        const image = new Image()
        image.decoding = 'async'
        let loaded = false
        image.onload = () => {
          loaded = true
          resume(Effect.succeed(image))
        }
        image.onerror = () => resume(Effect.fail(new Error('Could not load image')))
        image.src = src
        return Effect.sync(() => {
          image.onload = null
          image.onerror = null
          if (!loaded) image.src = ''
        })
      }).pipe(
        Effect.flatMap((image) => Effect.tryPromise(() => image.decode()).pipe(Effect.ignore)),
        Effect.tap(() =>
          Effect.sync(() => {
            owner.cancel(spinnerSlot)
            const previous = owner.read().load.displayed?.path
            dispatch({ kind: 'display', src, path })
            if (previous && previous !== path) options.onDisplayPath?.(path)
            prefetch()
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            owner.cancel(spinnerSlot)
            if (!forcedOriginal && enabled) {
              forcedOriginal = true
              update()
            } else dispatch({ kind: 'error' })
          }),
        ),
      ),
      'replace',
    )
  }
  const config = observeQuery(owner, queryCache, configQuery, (result) => {
    const value = available(result)
    enabled = value === undefined ? true : Boolean(value.enabled)
    update()
  })
  config.select(true)
  return {
    source: owner.source,
    select: (next: Options) => {
      options = next
      update()
    },
    attach: (element: HTMLElement) => {
      unobserve?.()
      const measure = () => {
        const bounds = element.getBoundingClientRect(),
          style = getComputedStyle(element)
        owner.patch({
          dimensions: {
            width: Math.max(
              0,
              bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            ),
            height: Math.max(
              0,
              bounds.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
            ),
          },
        })
        update()
      }
      const resize = new ResizeObserver(measure)
      resize.observe(element)
      const stopVisible = observeMediaVisibility(element, (next) => {
        visible = next
        prefetch()
      })
      window.addEventListener('resize', measure)
      measure()
      unobserve = () => {
        resize.disconnect()
        stopVisible()
        window.removeEventListener('resize', measure)
      }
    },
    retry: () => {
      forcedOriginal = false
      retryNonce++
      requested = ''
      update()
    },
    dispose: () => {
      unobserve?.()
      owner.dispose()
    },
  }
}
