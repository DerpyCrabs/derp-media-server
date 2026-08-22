import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'

export type AsyncValue<T> = {
  value: Accessor<T | undefined>
  loading: Accessor<boolean>
  error: Accessor<unknown>
}

export function createAsyncValue<T>(
  source: Accessor<string>,
  load: (source: string, signal: AbortSignal) => Promise<T>,
  dispose?: (value: T) => void | Promise<void>,
): AsyncValue<T> {
  const [value, setValue] = createSignal<T>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<unknown>()
  let controller: AbortController | undefined
  let currentValue: T | undefined

  const disposeValue = (released: T) => {
    try {
      void Promise.resolve(dispose?.(released)).catch(() => {})
    } catch {}
  }
  const replaceValue = (next: T | undefined) => {
    const previous = currentValue
    currentValue = next
    setValue(() => next)
    if (previous !== undefined && previous !== next) disposeValue(previous)
  }

  createEffect(source, (activeSource) => {
    controller?.abort()
    controller = new AbortController()
    replaceValue(undefined)
    setError(undefined)
    if (!activeSource) {
      setLoading(false)
      return
    }
    setLoading(true)
    const current = controller
    void load(activeSource, current.signal)
      .then((loaded) => {
        if (current.signal.aborted) disposeValue(loaded)
        else replaceValue(loaded)
      })
      .catch((reason) => {
        if (!current.signal.aborted) setError(reason)
      })
      .finally(() => {
        if (!current.signal.aborted) setLoading(false)
      })
  })

  onCleanup(() => {
    controller?.abort()
    replaceValue(undefined)
  })
  return { value, loading, error }
}
