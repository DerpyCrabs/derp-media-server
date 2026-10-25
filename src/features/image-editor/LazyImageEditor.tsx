import { Effect } from 'effect'
import { view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import { modalFocus } from '@/lib/ui/modal-focus'
import type { ImageEditorProps } from './image-editor-controller'
const Placeholder = view<{ props: ImageEditorProps; failed?: boolean }>(({ props, failed }) => (
  <div
    role={props.embedded ? 'region' : 'dialog'}
    aria-label='Image editor'
    aria-modal={props.embedded ? undefined : 'true'}
    use={modalFocus({ onEscape: props.onClose })}
    class={
      props.embedded
        ? 'relative flex h-full flex-col items-center justify-center bg-background'
        : 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-background'
    }
  >
    <p role={failed ? 'alert' : 'status'} class='p-4 text-center text-sm text-muted-foreground'>
      {failed
        ? 'Unable to load the image editor. Reload the page to try again.'
        : 'Loading image editor…'}
    </p>
    <button
      class='rounded border border-input px-3 py-2 text-sm hover:bg-muted'
      onClick={props.onClose}
    >
      Back to image
    </button>
  </div>
))
export const LazyImageEditor = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./ImageEditor')),
      (module) => module.default,
    ),
  {
    pending: view<ImageEditorProps>((props) => <Placeholder props={props} />),
    failure: view(({ model }) => <Placeholder props={model} failed />),
  },
)
