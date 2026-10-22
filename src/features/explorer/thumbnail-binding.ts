import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { thumbnailLoadQueue, type ThumbnailPriority } from '@/lib/media/thumbnail-load-queue'

type ThumbnailBinding = {
  url: string
  patch: (state: {
    queuedSrc?: string
    failed?: boolean
    attempt?: number
    priority?: ThumbnailPriority
  }) => void
}
const loadSlot = 'thumbnail-load'

export const thumbnailBinding = (target: HTMLDivElement, current: () => ThumbnailBinding) => {
  const owner = modelOwner({})
  let url = ''
  let visible = false
  let nearby = false
  const priority = (): ThumbnailPriority => (visible ? 'high' : 'low')
  let requested = false
  const cancel = () => {
    requested = false
    owner.cancel(loadSlot)
  }
  const load = () => {
    if ((!visible && !nearby) || requested) return
    requested = true
    const requestedUrl = url
    owner.run(
      loadSlot,
      Effect.sleep(125).pipe(
        Effect.andThen(
          thumbnailLoadQueue.run(
            priority,
            Effect.callback<void>((resume) => {
              const release = () => resume(Effect.void)
              target.addEventListener('load', release, true)
              target.addEventListener('error', release, true)
              current().patch({ queuedSrc: requestedUrl })
              return Effect.sync(() => {
                target.removeEventListener('load', release, true)
                target.removeEventListener('error', release, true)
              })
            }),
          ),
        ),
      ),
      'replace',
    )
  }
  const update = () => {
    const next = current()
    if (next.url === url) return
    cancel()
    url = next.url
    next.patch({ queuedSrc: undefined, failed: false })
    load()
  }
  const changed = () => {
    current().patch({ priority: priority() })
    thumbnailLoadQueue.refresh()
    if (visible || nearby) load()
    else {
      cancel()
      current().patch({ queuedSrc: undefined })
    }
  }
  let root: HTMLElement | null = target.parentElement
  while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement
  if (root === document.body || root === document.documentElement) root = null
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      changed()
    },
    { root, threshold: 0 },
  )
  observer.observe(target)
  const card = target.closest<HTMLElement>('[data-file-path]') ?? target
  let preloadObserver: IntersectionObserver | undefined
  let margin = -1
  const resize = new ResizeObserver(() => {
    const gap = Number.parseFloat(getComputedStyle(card.parentElement ?? card).rowGap) || 0
    const nextMargin = Math.ceil((card.getBoundingClientRect().height + gap) * 3)
    if (nextMargin === margin) return
    margin = nextMargin
    preloadObserver?.disconnect()
    preloadObserver = new IntersectionObserver(
      (entries) => {
        nearby = entries.some((entry) => entry.isIntersecting)
        changed()
      },
      { root, rootMargin: `${margin}px 0px`, threshold: 0 },
    )
    preloadObserver.observe(target)
  })
  resize.observe(card)
  update()
  return {
    update,
    dispose: () => {
      owner.dispose()
      observer.disconnect()
      preloadObserver?.disconnect()
      resize.disconnect()
    },
  }
}
