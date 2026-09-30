import { Effect } from 'effect'
import { commandSlot, lifetime } from 'effectweb'
const warmSlot = commandSlot('media-warmup')
export function createMediaWarmup() {
  const owner = lifetime()
  const completed = new Set<string>()
  let selected = ''
  const select = (urls: readonly string[]) => {
    const key = urls.join('\n')
    if (selected === key) return
    selected = key
    const wanted = new Set(urls)
    if (urls.length) for (const url of completed) if (!wanted.has(url)) completed.delete(url)
    owner.run(
      warmSlot,
      Effect.sleep(250).pipe(
        Effect.andThen(
          Effect.forEach(
            urls,
            (url) => {
              if (completed.has(url)) return Effect.void
              return Effect.tryPromise({
                try: async (signal) => {
                  const response = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    signal,
                  })
                  await response.text()
                  if (response.ok) completed.add(url)
                },
                catch: (error) => error,
              }).pipe(Effect.catch(() => Effect.void))
            },
            { concurrency: 1, discard: true },
          ),
        ),
      ),
      'replace',
    )
  }
  return { select, dispose: owner.dispose }
}
export function observeMediaVisibility(element: HTMLElement, changed: (visible: boolean) => void) {
  let visible = false
  const update = () => changed(visible && !document.hidden)
  const observer = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting)
    update()
  })
  observer.observe(element)
  document.addEventListener('visibilitychange', update)
  update()
  return () => {
    observer.disconnect()
    document.removeEventListener('visibilitychange', update)
  }
}
