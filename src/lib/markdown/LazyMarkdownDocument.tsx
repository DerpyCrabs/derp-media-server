import { Effect } from 'effect'
import { view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import type { MarkdownDocumentProps } from './types'

export const LazyMarkdownDocument = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./MarkdownDocument')),
      (module) => module.default,
    ),
  {
    pending: view<MarkdownDocumentProps>(() => (
      <p class='text-muted-foreground p-4 text-sm'>Loading Markdown…</p>
    )),
  },
)
