import { createEffect, createSignal, onSettled, type Accessor } from 'solid-js'

export function createMediaVisibility(element: Accessor<HTMLElement | undefined>) {
  const [visible, setVisible] = createSignal(false)
  const [tabVisible, setTabVisible] = createSignal(!document.hidden)
  onSettled(() => {
    const update = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    // eslint-disable-next-line solid/reactivity
    return () => document.removeEventListener('visibilitychange', update)
  })
  createEffect(element, (target) => {
    setVisible(false)
    if (!target) return undefined
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(Boolean(entry?.isIntersecting)),
    )
    observer.observe(target)
    // eslint-disable-next-line solid/reactivity
    return () => observer.disconnect()
  })
  return () => visible() && tabVisible()
}

export function createMediaWarmup(urls: Accessor<string[]>) {
  const completed = new Set<string>()
  createEffect(urls, (pending) => {
    const wanted = new Set(pending)
    if (pending.length) for (const url of completed) if (!wanted.has(url)) completed.delete(url)
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      for (const url of pending) {
        if (controller.signal.aborted) break
        if (completed.has(url)) continue
        try {
          const response = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            signal: controller.signal,
          })
          await response.text()
          if (response.ok) completed.add(url)
        } catch {
          if (controller.signal.aborted) break
        }
      }
    }
    timer = setTimeout(() => {
      void run()
    }, 250)
    // eslint-disable-next-line solid/reactivity
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  })
}
