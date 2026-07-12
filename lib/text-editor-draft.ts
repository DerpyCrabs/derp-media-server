const PREFIX = 'text-editor-draft-v1:'

export type TextEditorDraft = {
  content: string
  updatedAt: number
}

export function textEditorDraftKey(scope: string, path: string): string {
  return `${PREFIX}${encodeURIComponent(scope)}:${encodeURIComponent(path)}`
}

export function readTextEditorDraft(key: string): TextEditorDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<TextEditorDraft> | null
    if (!value || typeof value.content !== 'string' || typeof value.updatedAt !== 'number') return null
    return { content: value.content, updatedAt: value.updatedAt }
  } catch {
    return null
  }
}

export function writeTextEditorDraft(key: string, content: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ content, updatedAt: Date.now() }))
  } catch {
    // Saving to the server remains available when storage is disabled or full.
  }
}

export function removeTextEditorDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage may be unavailable in privacy-restricted browsers.
  }
}
