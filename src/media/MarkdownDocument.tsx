import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js'

import { createMarkdownEditor, type MarkdownEditorController } from './markdown/create-editor'
import type { MarkdownDocumentProps, MarkdownEditorRuntime } from './markdown/types'

export default function MarkdownDocument(props: MarkdownDocumentProps): JSX.Element {
  let mountElement!: HTMLDivElement
  let expandedDialog!: HTMLDivElement
  let imageReturnFocus: HTMLElement | null = null
  const [controller, setController] = createSignal<MarkdownEditorController | null>(null)
  const [expandedImage, setExpandedImage] = createSignal<{ src: string; alt: string } | null>(null)

  const closeExpandedImage = () => {
    setExpandedImage(null)
    requestAnimationFrame(() => imageReturnFocus?.focus())
  }

  const runtime: MarkdownEditorRuntime = {
    resolveImageUrl: (src) => props.resolveImageUrl(src),
    openImage: (src, alt) => {
      if (props.onOpenImage) {
        props.onOpenImage(src, alt)
        return
      }
      imageReturnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      setExpandedImage({ src, alt: alt ?? '' })
    },
    onChange: (content) => props.onChange?.(content),
    onBlur: () => props.onBlur?.(),
    onSave: () => props.onSave?.(),
    onPasteImage: (event, selection, complete) =>
      props.onPasteImage?.(event, selection, complete) ?? false,
  }

  onMount(() => {
    const next = createMarkdownEditor({
      parent: mountElement,
      doc: props.content,
      mode: props.mode,
      ariaLabel:
        props.ariaLabel ?? (props.mode === 'read' ? 'Markdown document' : 'Markdown editor'),
      runtime,
    })
    setController(next)
  })

  createEffect(() => {
    const next = controller()
    const mode = props.mode
    const label = props.ariaLabel ?? (mode === 'read' ? 'Markdown document' : 'Markdown editor')
    next?.setMode(mode, label)
  })

  createEffect(() => {
    const content = props.content
    controller()?.setContent(content)
  })

  createEffect(() => {
    const resolveImageUrl = props.resolveImageUrl
    const onChange = props.onChange
    const onBlur = props.onBlur
    const onSave = props.onSave
    const onPasteImage = props.onPasteImage
    runtime.resolveImageUrl = resolveImageUrl
    runtime.onChange = onChange
    runtime.onBlur = onBlur
    runtime.onSave = onSave
    runtime.onPasteImage = onPasteImage
    controller()?.refresh()
  })

  createEffect(() => {
    if (!expandedImage()) return
    requestAnimationFrame(() => expandedDialog?.focus())
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeExpandedImage()
    }
    window.addEventListener('keydown', closeOnEscape)
    onCleanup(() => window.removeEventListener('keydown', closeOnEscape))
  })

  onCleanup(() => controller()?.destroy())

  return (
    <div
      class='markdown-document relative h-full min-h-full overflow-hidden'
      classList={{ 'markdown-document-compact': props.compact === true }}
      data-testid='markdown-document'
      data-mode={props.mode}
    >
      <div ref={mountElement} class='h-full min-h-full' />
      <Show when={expandedImage()}>
        {(src) => (
          <div
            role='dialog'
            aria-modal='true'
            aria-label='View image fullscreen'
            tabindex={0}
            ref={expandedDialog}
            class='absolute inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/90 p-4'
            onClick={(event) => event.target === event.currentTarget && closeExpandedImage()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                closeExpandedImage()
              }
            }}
          >
            <button
              type='button'
              class='absolute top-4 right-4 z-10 rounded-md p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white'
              onClick={closeExpandedImage}
              aria-label='Close'
            >
              ×
            </button>
            <img
              src={src().src}
              alt={src().alt}
              class='max-h-full max-w-full cursor-default object-contain'
              draggable={false}
              loading='eager'
            />
          </div>
        )}
      </Show>
    </div>
  )
}
