import { Effect } from 'effect'
import { Portal, view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import { modalFocus } from '@/lib/ui/modal-focus'
import type { TextPrintProps } from './TextPrintDialog'
const Placeholder = view<{ props: TextPrintProps; failed?: boolean }>(({ props, failed }) => (
  <Portal>
    <div class='fixed inset-0 z-[1000003] flex items-center justify-center bg-black/60 p-4'>
      <section
        role='dialog'
        aria-modal='true'
        aria-label='Print document'
        use={modalFocus({ onEscape: props.onClose })}
        class='rounded-xl border border-border bg-popover p-6 text-popover-foreground'
      >
        <p role={failed ? 'alert' : 'status'}>
          {failed
            ? 'Unable to load print tools. Reload the page and try again.'
            : 'Loading print tools…'}
        </p>
        <button
          type='button'
          class='mt-4 rounded border border-input px-3 py-2'
          onClick={props.onClose}
        >
          Close
        </button>
      </section>
    </div>
  </Portal>
))
export const LazyTextPrintDialog = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./TextPrintDialog')),
      (module) => module.TextPrintDialog,
    ),
  {
    pending: view<TextPrintProps>((props) => <Placeholder props={props} />),
    failure: view(({ model }) => <Placeholder props={model} failed />),
  },
)
