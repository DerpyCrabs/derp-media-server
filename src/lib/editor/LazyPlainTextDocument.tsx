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
    failure: view(({ model }) => (
      <div class='flex h-full min-h-0 flex-col'>
        <p role='alert' class='border-b border-border p-3 text-sm text-destructive'>
          The editor could not be loaded. Reload the page to try again. Your text is still available
          below.
        </p>
        <pre class='min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 text-sm'>
          {model.content}
        </pre>
      </div>
    )),
    pending: view<PlainTextDocumentProps>(() => (
      <p class='p-4 text-sm text-muted-foreground'>Loading editor…</p>
    )),
  },
)
