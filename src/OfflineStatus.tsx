import { openAndroidOffline } from './lib/android-bridge'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'

type OfflineEvent = {
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'removed'
  name?: string
  path?: string
  completed?: number
}

export function OfflineStatus() {
  const [status, setStatus] = createSignal<OfflineEvent | null>(null)
  let dismissTimer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<OfflineEvent>).detail
      setStatus(detail)
      if (dismissTimer) clearTimeout(dismissTimer)
      if (detail.state === 'succeeded' || detail.state === 'failed' || detail.state === 'removed') {
        dismissTimer = setTimeout(() => setStatus(null), 5000)
      }
    }
    window.addEventListener('derp-offline-status', listener)
    onCleanup(() => {
      window.removeEventListener('derp-offline-status', listener)
      if (dismissTimer) clearTimeout(dismissTimer)
    })
  })

  const message = () => {
    const value = status()
    if (!value) return ''
    if (value.state === 'queued') return `Waiting to save ${value.name ?? 'item'}…`
    if (value.state === 'running') {
      const count = value.completed ? ` · ${value.completed} files` : ''
      return `Saving ${value.name ?? 'item'}${count}…`
    }
    if (value.state === 'succeeded') return `${value.name ?? 'Item'} is available offline`
    if (value.state === 'removed') return `${value.name ?? 'Item'} was removed from offline files`
    return `Couldn't save ${value.name ?? 'item'}`
  }

  return (
    <Show when={status()}>
      <button
        type='button'
        class='fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-10020 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover px-4 py-3 text-left text-sm text-popover-foreground shadow-lg'
        onClick={() => openAndroidOffline()}
      >
        <span class='block font-medium'>{message()}</span>
        <span class='text-muted-foreground mt-0.5 block text-xs'>Open offline files</span>
      </button>
    </Show>
  )
}
