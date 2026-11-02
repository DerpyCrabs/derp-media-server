import { Effect } from 'effect'
import { view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import type { MergeDocumentProps } from './MergeDocument'
export const LazyMergeDocument = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./MergeDocument')),
      (module) => module.default,
    ),
  {
    pending: view<MergeDocumentProps>((props) => (
      <div class='flex items-center gap-2 p-2'>
        <span class='mr-auto text-sm text-muted-foreground'>Loading comparison…</span>
        {props.toolbarEnd}
      </div>
    )),
    failure: view<{ model: MergeDocumentProps }>((props) => (
      <div class='p-2'>
        <div class='flex justify-end gap-1'>{props.model.toolbarEnd}</div>
        <p role='alert' class='p-2 text-sm text-destructive'>
          Comparison could not be loaded.
        </p>
      </div>
    )),
  },
)
