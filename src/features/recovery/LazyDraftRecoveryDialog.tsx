import { Effect } from 'effect'
import { view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import type { DraftRecoveryProps } from './draft-recovery-controller'
import { modalFocus } from '@/lib/ui/modal-focus'
import { modalDialogBackdropClass } from '@/features/explorer/modal-overlay-scope'
const fallback = (message: string) =>
  view<DraftRecoveryProps>((props) => (
    <div class={modalDialogBackdropClass()}>
      <section
        role='dialog'
        aria-modal='true'
        aria-label='Local drafts'
        use={modalFocus({ onEscape: props.onClose })}
        class='rounded-lg border border-border bg-background p-4 text-foreground'
      >
        <p role='status' class='text-sm'>
          {message}
        </p>
        <button class='mt-3 rounded border border-input px-3 py-1 text-sm' onClick={props.onClose}>
          Close
        </button>
      </section>
    </div>
  ))
const Failed = fallback(
  'The recovery panel could not load. Reload the app to try again. Your backups remain in this browser.',
)
export const LazyDraftRecoveryDialog = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./DraftRecoveryDialog')),
      (module) => module.default,
    ),
  {
    pending: fallback('Loading local drafts…'),
    failure: view(({ model }) => <Failed {...model} />),
  },
)
