type ReadingProgressOptions = {
  element: HTMLElement
  key: () => string | null
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  retryDelays?: number[]
}

const CANVAS_READING_POSITION_PREFIX = 'canvas-reading-position-v1'

export function canvasReadingProgressKey(canvasId: string, path: string): string {
  return `${CANVAS_READING_POSITION_PREFIX}:${canvasId}:${path}`
}

export function bindReadingProgress(options: ReadingProgressOptions): () => void {
  const storage = options.storage ?? localStorage
  let restoredKey: string | null = null
  let restoredTarget: HTMLElement | null = null

  const restore = () => {
    const key = options.key()
    const ratio = key ? Number(storage.getItem(key)) : 0
    if (!(ratio > 0) || !Number.isFinite(ratio)) return
    const scrollable = [...options.element.querySelectorAll<HTMLElement>('*')].find(
      (candidate) => candidate.scrollHeight > candidate.clientHeight + 8,
    )
    if (!scrollable || (restoredKey === key && restoredTarget === scrollable)) return
    scrollable.scrollTop = ratio * (scrollable.scrollHeight - scrollable.clientHeight)
    restoredKey = key
    restoredTarget = scrollable
  }

  const onScroll = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || target.scrollHeight <= target.clientHeight) return
    const key = options.key()
    if (!key) return
    const range = target.scrollHeight - target.clientHeight
    storage.setItem(key, String(range > 0 ? target.scrollTop / range : 0))
  }

  const observer = new MutationObserver(() => queueMicrotask(restore))
  observer.observe(options.element, { childList: true, subtree: true })
  options.element.addEventListener('scroll', onScroll, true)
  queueMicrotask(restore)
  const retryTimers = (options.retryDelays ?? [500, 2_000, 5_000]).map((delay) =>
    window.setTimeout(restore, delay),
  )

  return () => {
    observer.disconnect()
    options.element.removeEventListener('scroll', onScroll, true)
    for (const timer of retryTimers) window.clearTimeout(timer)
  }
}
