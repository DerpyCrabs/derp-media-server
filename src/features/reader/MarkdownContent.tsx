import { view } from 'effectweb'
import { LazyMarkdownDocument } from '@/lib/markdown/LazyMarkdownDocument'
export const MarkdownContent = view<{ content: string }>((props) => {
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
})
