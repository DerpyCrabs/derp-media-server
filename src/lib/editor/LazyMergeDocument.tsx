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
    pending: view<MergeDocumentProps>(() => (
      <p class='p-4 text-sm text-muted-foreground'>Loading comparison…</p>
    )),
    failure: view(() => (
      <p role='alert' class='p-4 text-sm text-destructive'>
        Comparison could not be loaded. Close this dialog and download your draft before reloading.
      </p>
    )),
  },
)
