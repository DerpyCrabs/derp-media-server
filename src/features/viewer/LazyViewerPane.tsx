import X from '@effectweb/lucide/icons/x'
import { modalScroll } from './modal-scroll'
import { Effect } from 'effect'
import { domBinding, view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import type { ViewerPaneProps } from './ViewerPane'
import { modalFocus } from '@/lib/ui/modal-focus'

const Placeholder = view<{ props: ViewerPaneProps; failed?: boolean }>(({ props, failed }) => (
  <div class='contents' use={domBinding(props.presentation === 'modal', modalScroll)}>
    <div
      data-no-window-drag
      use={
        props.presentation === 'modal'
          ? modalFocus({ onEscape: () => props.onClose?.() })
          : undefined
      }
      role={props.presentation === 'modal' ? 'dialog' : undefined}
      aria-modal={props.presentation === 'modal' ? 'true' : undefined}
      aria-label={props.presentation === 'modal' ? 'File viewer' : undefined}
      class={
        props.presentation === 'modal'
          ? 'fixed inset-0 z-50 flex items-center justify-center bg-background'
          : 'absolute inset-0 flex min-h-0 flex-col items-center justify-center overflow-hidden bg-background'
      }
    >
      <p role={failed ? 'alert' : 'status'} class='p-4 text-sm text-muted-foreground'>
        {failed ? 'Unable to load viewer. Reload the page to try again.' : 'Loading viewer…'}
      </p>
      {props.presentation === 'modal' ? (
        <button
          type='button'
          title='Close'
          aria-label='Close'
          class='hover:bg-muted absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-md'
          onClick={() => props.onClose?.()}
        >
          <X class='h-4 w-4' />
        </button>
      ) : null}
    </div>
  </div>
))

const Content = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./ViewerPane')),
      (module) => module.ViewerPane,
    ),
  {
    pending: view<ViewerPaneProps>((props) => <Placeholder props={props} />),
    failure: view(({ model }) => <Placeholder props={model} failed />),
  },
)

export const ViewerPane = view<ViewerPaneProps>((props) =>
  props.viewingPath ? <Content {...props} /> : null,
)
