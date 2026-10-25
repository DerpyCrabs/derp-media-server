import { Effect } from 'effect'
import { view } from 'effectweb'
import { lazyView } from 'effectweb/advanced'
import type { ImageEditorProps } from './image-editor-controller'
export const LazyImageEditor = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./ImageEditor')),
      (module) => module.default,
    ),
  {
    pending: view<ImageEditorProps>(() => (
      <p class='p-4 text-sm text-muted-foreground'>Loading image editor…</p>
    )),
  },
)
