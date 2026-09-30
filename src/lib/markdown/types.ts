import type { Effect } from 'effect'
export type MarkdownMode = 'read' | 'edit'

export type MarkdownSelection = { from: number; to: number }

export type MarkdownImagePasteHandler = (
  event: ClipboardEvent,
  selection: MarkdownSelection,
  complete: (markdown: string | null) => boolean,
) => false | Effect.Effect<void, unknown>

export type MarkdownDocumentProps = {
  content: string
  mode: MarkdownMode
  onChange?: (content: string) => void
  onBlur?: () => void
  onSave?: () => Effect.Effect<void, unknown>
  resolveImageUrl: (src: string) => string | null
  onOpenImage?: (src: string, alt?: string) => void
  onPasteImage?: MarkdownImagePasteHandler
  ariaLabel?: string
  compact?: boolean
}

export type MarkdownEditorRuntime = {
  resolveImageUrl: (src: string) => string | null
  openImage: (src: string, alt?: string) => void
  onChange?: (content: string) => void
  onBlur?: () => void
  onSave?: () => Effect.Effect<void, unknown>
  onPasteImage?: MarkdownImagePasteHandler
}
