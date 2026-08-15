import { Loading, lazy } from 'solid-js'
import type { JSX } from '@solidjs/web'

import type { MarkdownDocumentProps } from './types'

const MarkdownDocument = lazy(() => import('./MarkdownDocument'))

export function LazyMarkdownDocument(props: MarkdownDocumentProps): JSX.Element {
  return (
    <Loading fallback={<p class='text-muted-foreground p-4 text-sm'>Loading Markdown…</p>}>
      <MarkdownDocument
        content={props.content}
        mode={props.mode}
        onChange={props.onChange}
        onBlur={props.onBlur}
        onSave={props.onSave}
        resolveImageUrl={props.resolveImageUrl}
        onOpenImage={props.onOpenImage}
        onPasteImage={props.onPasteImage}
        ariaLabel={props.ariaLabel}
        compact={props.compact}
      />
    </Loading>
  )
}
