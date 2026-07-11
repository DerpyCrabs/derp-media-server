import { isAndroidPathAvailableOffline, isOfflineFeatureAvailable } from './lib/android-bridge'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'

export function OfflineBadge(props: { path: string }) {
  const [available, setAvailable] = createSignal(false)

  onMount(() => {
    if (!isOfflineFeatureAvailable()) return
    const update = () => setAvailable(isAndroidPathAvailableOffline(props.path))
    update()
    window.addEventListener('derp-offline-catalog', update)
    onCleanup(() => window.removeEventListener('derp-offline-catalog', update))
  })

  return (
    <Show when={available()}>
      <span class='ml-1.5 inline-flex shrink-0 items-center rounded bg-primary/15 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary'>
        Offline
      </span>
    </Show>
  )
}
