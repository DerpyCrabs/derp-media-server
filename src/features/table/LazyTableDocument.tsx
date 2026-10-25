import { Effect } from 'effect'
import { view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import type { TableDocumentProps } from './table-controller'
export const LazyTableDocument = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./TableDocument')),
      (module) => module.default,
    ),
  {
    pending: view<TableDocumentProps>(() => (
      <p class='p-4 text-sm text-muted-foreground'>Loading table…</p>
    )),
    failure: view(() => (
      <p role='alert' class='p-4 text-sm text-destructive'>
        The table could not be loaded. Switch to Text to read or edit the file.
      </p>
    )),
  },
)
