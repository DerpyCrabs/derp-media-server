import type { Accessor } from 'solid-js'
import { Match, Switch } from 'solid-js'
import CircleCheck from 'lucide-solid/icons/circle-check'
import CircleX from 'lucide-solid/icons/circle-x'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import type { UploadToastState } from './types'
import { uploadToastPanelClass } from './types'

type UploadToastStackProps = {
  state: Accessor<UploadToastState>
  onDismissError: () => void
}

export function UploadToastStack(props: UploadToastStackProps) {
  return (
    <Switch>
      <Match when={props.state().kind === 'uploading' ? props.state() : false}>
        {(get) => {
          const s = get() as Extract<UploadToastState, { kind: 'uploading' }>
          return (
            <div class={uploadToastPanelClass}>
              <div class='flex items-center gap-3'>
                <LoaderCircle
                  class='h-5 w-5 text-primary shrink-0 animate-spin'
                  size={20}
                  stroke-width={2}
                />
                <span class='text-sm font-medium'>
                  Uploading {s.fileCount} {s.fileCount === 1 ? 'file' : 'files'}
                  ...
                </span>
              </div>
            </div>
          )
        }}
      </Match>
      <Match when={props.state().kind === 'success'}>
        <div class={uploadToastPanelClass}>
          <div class='flex items-center gap-3'>
            <CircleCheck class='h-5 w-5 text-green-500 shrink-0' size={20} stroke-width={2} />
            <span class='text-sm font-medium'>Upload complete</span>
          </div>
        </div>
      </Match>
      <Match when={props.state().kind === 'error' ? props.state() : false}>
        {(get) => {
          const s = get() as Extract<UploadToastState, { kind: 'error' }>
          return (
            <div class={uploadToastPanelClass}>
              <div class='flex items-start gap-3'>
                <CircleX
                  class='h-5 w-5 text-destructive shrink-0 mt-0.5'
                  size={20}
                  stroke-width={2}
                />
                <div class='flex-1 min-w-0'>
                  <p class='text-sm font-medium text-destructive'>Upload failed</p>
                  <p class='text-xs text-muted-foreground mt-0.5 wrap-break-word'>{s.message}</p>
                </div>
                <button
                  type='button'
                  class='h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-md hover:bg-accent'
                  onClick={() => props.onDismissError()}
                  aria-label='Dismiss'
                >
                  <span class='text-lg leading-none'>×</span>
                </button>
              </div>
            </div>
          )
        }}
      </Match>
    </Switch>
  )
}
