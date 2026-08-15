import { LazyMarkdownDocument } from '@/lib/markdown/LazyMarkdownDocument'

export function MarkdownContent(props: { content: string }) {
  return (
    <div class='reader-markdown'>
      <LazyMarkdownDocument
        content={props.content}
        mode='read'
        compact
        resolveImageUrl={() => null}
        ariaLabel='Definition result'
      />
    </div>
  )
}
