export type MarkdownImagePasteCompletion = (markdown: string | null) => boolean

/** Completes an editor-owned paste, then checks whether its new content needs an explicit save. */
export function completeMarkdownImagePaste(
  markdown: string | null,
  complete: MarkdownImagePasteCompletion,
  shouldSaveAfterFlush: () => boolean,
  save: () => void,
): boolean {
  const accepted = complete(markdown)
  if (!accepted || markdown === null) return accepted

  queueMicrotask(() => {
    if (shouldSaveAfterFlush()) save()
  })
  return true
}
