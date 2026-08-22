import { Loading, Match, Show, Switch, lazy } from 'solid-js'
import { ReaderPreferencesProvider } from './ReaderPreferences'
import type { ReaderContentKind, ReaderPresentation } from './reader-types'

const PdfReader = lazy(() => import('./contentTypes/pdf/PdfReader'))
const DirectoryReader = lazy(() => import('./contentTypes/directory/DirectoryReader'))
const BookReader = lazy(() => import('./contentTypes/book/BookReader'))

export type ReaderProps = ReaderPresentation & {
  sourcePath: string
  kind: ReaderContentKind
}

export function Reader(props: ReaderProps) {
  const source = () => (props.sourcePath ? `${props.kind}\0${props.sourcePath}` : '')
  return (
    <Show when={source()} keyed>
      {(_source) => (
        <ReaderPreferencesProvider>
          <Loading fallback={<div class='absolute inset-0 bg-neutral-900' />}>
            <Switch>
              <Match when={props.kind === 'pdf'}>
                <PdfReader {...props} />
              </Match>
              <Match when={props.kind === 'directory'}>
                <DirectoryReader {...props} />
              </Match>
              <Match when={props.kind === 'book'}>
                <BookReader {...props} />
              </Match>
            </Switch>
          </Loading>
        </ReaderPreferencesProvider>
      )}
    </Show>
  )
}
