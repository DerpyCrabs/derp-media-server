import { ImageLightbox } from '@/lib/ui/image-lightbox'
import { Effect } from 'effect'
import { cn } from '@/lib/ui/cn'
import { domBinding, component, view } from 'effectweb'
import { createMarkdownEditor } from './create-editor'
import type { MarkdownDocumentProps, MarkdownEditorRuntime } from './types'
type EditorBinding = MarkdownDocumentProps & { openImage: (src: string, alt?: string) => void }
const editorBinding = (parent: HTMLDivElement, current: () => EditorBinding) => {
  const runtime: MarkdownEditorRuntime = {
    resolveImageUrl: (src) => current().resolveImageUrl(src),
    openImage: (src, alt) => (current().onOpenImage ?? current().openImage)(src, alt),
    onChange: (content) => current().onChange?.(content),
    onBlur: () => current().onBlur?.(),
    onSave: () => current().onSave?.() ?? Effect.void,
    onPasteImage: (event, selection, complete) =>
      current().onPasteImage?.(event, selection, complete) ?? false,
  }
  const initial = current()
  let mode = initial.mode
  let ariaLabel = initial.ariaLabel ?? (mode === 'read' ? 'Markdown document' : 'Markdown editor')
  const editor = createMarkdownEditor({
    parent,
    doc: initial.content,
    mode: initial.mode,
    ariaLabel,
    runtime,
  })
  return {
    update: () => {
      const props = current()
      const nextLabel =
        props.ariaLabel ?? (props.mode === 'read' ? 'Markdown document' : 'Markdown editor')
      if (mode !== props.mode || ariaLabel !== nextLabel) {
        mode = props.mode
        ariaLabel = nextLabel
        editor.setMode(mode, ariaLabel)
      }
      editor.setContent(props.content)
      editor.refresh()
    },
    dispose: () => editor.destroy(),
  }
}
const MarkdownDocument = component<
  MarkdownDocumentProps,
  { expandedImage: { src: string; alt: string } | null }
>(
  { init: () => ({ expandedImage: null }) },
  view((model, patch) => {
    const props = model.props
    const close = () => patch({ expandedImage: null })
    return (
      <div
        class={cn('markdown-document relative h-full min-h-full overflow-hidden', {
          'markdown-document-compact': props.compact === true,
        })}
        data-testid='markdown-document'
        data-mode={props.mode}
      >
        <div
          class='h-full min-h-full'
          use={domBinding(
            {
              ...props,
              openImage: (src: string, alt?: string) =>
                patch({ expandedImage: { src, alt: alt ?? '' } }),
            },
            editorBinding,
          )}
        />
        {model.expandedImage ? (
          <ImageLightbox
            src={model.expandedImage.src}
            alt={model.expandedImage.alt || 'View image fullscreen'}
            onClose={close}
          />
        ) : null}
      </div>
    )
  }),
)
export default MarkdownDocument
