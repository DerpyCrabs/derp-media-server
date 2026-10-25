import { Effect } from 'effect'
import { view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import type { PlainTextDocumentProps } from './PlainTextDocument'
export const LazyPlainTextDocument = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./PlainTextDocument')),
      (module) => module.default,
    ),
  {
    pending: view<PlainTextDocumentProps>(() => (
      <p class='p-4 text-sm text-muted-foreground'>Loading editor…</p>
    )),
  },
)
