import type { ResourceKey } from './domain/resource'

const PREFIX = 'text-editor-draft-v1:'

type DraftStorage = Pick<Storage, 'getItem'>

export type TextEditorDraft = {
  content: string
  updatedAt: number
}

export function textEditorDraftKey(resource: ResourceKey): string {
  return `${PREFIX}${encodeURIComponent(resource.provider)}:${encodeURIComponent(resource.id)}`
}

export function readTextEditorDraft(
  key: string,
  storage: DraftStorage = localStorage,
): TextEditorDraft | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as Partial<TextEditorDraft> | null
    if (!value || typeof value.content !== 'string' || typeof value.updatedAt !== 'number')
      return null
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
