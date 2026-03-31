import CircleX from 'lucide-solid/icons/circle-x'
import { Show, createMemo } from 'solid-js'
import { dismissForbiddenNotice, useForbiddenNotifyStore } from '@/lib/forbidden-notify'
import { useStoreSync } from './lib/solid-store-sync'
import { uploadToastPanelClass } from './file-browser/types'

export function GlobalForbiddenToast() {
  const tick = useStoreSync(useForbiddenNotifyStore)
  const message = createMemo(() => {
    void tick()
    return useForbiddenNotifyStore.getState().message
  })

  return (
    <Show when={message()}>
      {(msg) => (
        <div class={uploadToastPanelClass}>
          <div class='flex items-start gap-3'>
            <CircleX class='h-5 w-5 text-destructive shrink-0 mt-0.5' size={20} stroke-width={2} />
            <div class='flex-1 min-w-0'>
              <p class='text-sm font-medium text-destructive'>Not allowed</p>
              <p class='text-xs text-muted-foreground mt-0.5 wrap-break-word'>{msg()}</p>
            </div>
            <button
              type='button'
              class='h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-accent'
              onClick={() => dismissForbiddenNotice()}
              aria-label='Dismiss'
            >
              <span class='text-lg leading-none'>×</span>
            </button>
          </div>
        </div>
      )}
    </Show>
  )
}
