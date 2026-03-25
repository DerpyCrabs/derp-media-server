/** When false, leave default paste behavior (e.g. into search, rename, dialogs). */
export function shouldOfferPasteAsNewFile(e: ClipboardEvent): boolean {
  const t = e.target
  if (t instanceof HTMLTextAreaElement) return false
  if (t instanceof HTMLInputElement) return false
  if (t instanceof HTMLElement && t.isContentEditable) return false
  return true
}
