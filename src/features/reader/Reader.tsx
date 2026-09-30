import { domMount, view } from 'effectweb'
import { Effect } from 'effect'
import { lazyView } from 'effectweb/advanced'
import { ReaderPreferencesProvider, readerPreferences } from './ReaderPreferences'
import type { ReaderContentKind, ReaderContentProps, ReaderPresentation } from './reader-types'

const pending = view<ReaderContentProps>(() => <div class='absolute inset-0 bg-neutral-900' />)
const PdfReader = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./contentTypes/pdf/PdfReader')),
      (module) => module.default,
    ),
  { pending },
)
const DirectoryReader = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./contentTypes/directory/DirectoryReader')),
      (module) => module.default,
    ),
  { pending },
)
const BookReader = lazyView(
  () =>
    Effect.map(
      Effect.tryPromise(() => import('./contentTypes/book/BookReader')),
      (module) => module.default,
    ),
  { pending },
)
export type ReaderProps = ReaderPresentation & { sourcePath: string; kind: ReaderContentKind }
const startPreferences = domMount(() => readerPreferences.start())
export const Reader = view<ReaderProps>((props) =>
  props.sourcePath ? (
    <div class='contents' use={startPreferences}>
      <ReaderPreferencesProvider>
        {props.kind === 'pdf' ? (
          <PdfReader {...props} />
        ) : props.kind === 'directory' ? (
          <DirectoryReader {...props} />
        ) : (
          <BookReader {...props} />
        )}
      </ReaderPreferencesProvider>
    </div>
  ) : null,
)
