export type AuthConfig = {
  enabled: boolean
  shareLinkDomain?: string
  editableFolders: string[]
  mediaRoots?: {
    id: string
    name: string
    editableFolders: string[]
    readOnly: boolean
    source: 'config' | 'mount'
  }[]
}

export type UploadToastState =
  | { kind: 'hidden' }
  | { kind: 'uploading'; fileCount: number }
  | { kind: 'success' }
  | { kind: 'error'; message: string }
  | { kind: 'copied'; label?: string; warning?: string | null }
  | { kind: 'clipboardError'; message: string; url?: string; warning?: string | null }

export type UploadToastAnchor = 'viewport' | 'window'

export function uploadToastPanelClass(anchor: UploadToastAnchor = 'viewport'): string {
  const pos = anchor === 'window' ? 'absolute' : 'fixed'
  return `${pos} bottom-4 right-4 z-50 min-w-[280px] max-w-sm rounded-lg border border-border bg-background shadow-lg p-3 text-foreground`
}
