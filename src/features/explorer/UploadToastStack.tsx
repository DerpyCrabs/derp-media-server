import { view } from 'effectweb'
import CircleCheck from '@effectweb/lucide/icons/circle-check'
import CircleX from '@effectweb/lucide/icons/circle-x'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import { uploadToastPanelClass, type UploadToastAnchor, type UploadToastState } from './types'
export const UploadToastStack = view<{
  state: UploadToastState
  onDismissError: () => void
  toastAnchor?: UploadToastAnchor
}>((props) => {
  const state = props.state
  if (state.kind === 'hidden') return null
  return (
    <div class={uploadToastPanelClass(props.toastAnchor)}>
      <div class='flex items-center gap-3'>
        {state.kind === 'uploading' ? (
          <>
            <LoaderCircle class='h-5 w-5 text-primary shrink-0 animate-spin' size={20} />
            <span class='text-sm font-medium'>
              Uploading {state.fileCount} {state.fileCount === 1 ? 'file' : 'files'}...
            </span>
          </>
        ) : state.kind === 'success' ? (
          <>
            <CircleCheck class='h-5 w-5 text-green-500 shrink-0' size={20} />
            <span class='text-sm font-medium'>Upload complete</span>
          </>
        ) : (
          <>
            <CircleX class='h-5 w-5 text-destructive shrink-0' size={20} />
            <div class='flex-1 min-w-0'>
              <p class='text-sm font-medium text-destructive'>Upload failed</p>
              <p class='text-xs text-muted-foreground mt-0.5 wrap-break-word'>{state.message}</p>
            </div>
            <button
              type='button'
              class='h-6 w-6 shrink-0 rounded-md hover:bg-accent'
              onClick={props.onDismissError}
              aria-label='Dismiss'
            >
              ×
            </button>
          </>
        )}
      </div>
    </div>
  )
})
