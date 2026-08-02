import { Suspense, lazy, type JSX } from 'solid-js'

import type { MarkdownDocumentProps } from './markdown/types'

const MarkdownDocument = lazy(() => import('./MarkdownDocument'))

export function LazyMarkdownDocument(props: MarkdownDocumentProps): JSX.Element {
  return (
    <Suspense fallback={<p class='text-muted-foreground p-4 text-sm'>Loading Markdown…</p>}>
      <MarkdownDocument
        content={props.content}
        mode={props.mode}
        onChange={props.onChange}
        onBlur={props.onBlur}
        onSave={props.onSave}
        resolveImageUrl={props.resolveImageUrl}
        onPasteImage={props.onPasteImage}
        ariaLabel={props.ariaLabel}
        compact={props.compact}
      />
    </Suspense>
  )
}
