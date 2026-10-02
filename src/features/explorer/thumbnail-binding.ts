import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { thumbnailLoadQueue } from '@/lib/media/thumbnail-load-queue'

type ThumbnailBinding = {
  url: string
  generated: boolean
  patch: (state: { queuedSrc?: string; failed?: boolean; attempt?: number }) => void
}
const loadSlot = 'thumbnail-load'

export const thumbnailBinding = (target: HTMLDivElement, current: () => ThumbnailBinding) => {
  const owner = modelOwner({})
  let url = ''
  let visible = false
  let requested = false
  const cancel = () => {
    requested = false
    owner.cancel(loadSlot)
  }
  const load = () => {
    if (!visible || requested) return
    requested = true
    const requestedUrl = url
    owner.run(
      loadSlot,
      Effect.sleep(125).pipe(
        Effect.andThen(
          thumbnailLoadQueue.withPermits(1)(
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
    if (next.generated) {
      requested = true
      next.patch({ queuedSrc: url })
    } else load()
  }
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      if (visible) load()
      else {
        cancel()
        current().patch({ queuedSrc: undefined })
      }
    },
    { threshold: 0.01 },
  )
  observer.observe(target)
  update()
  return {
    update,
    dispose: () => {
      owner.dispose()
      observer.disconnect()
    },
  }
}
