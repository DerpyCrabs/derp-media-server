export type AuthConfig = {
  enabled: boolean
  shareLinkDomain?: string
  editableFolders: string[]
}

export type UploadToastState =
  | { kind: 'hidden' }
  | { kind: 'uploading'; fileCount: number }
  | { kind: 'success' }
  | { kind: 'error'; message: string }
  | { kind: 'copied'; label?: string }
  | { kind: 'clipboardError'; message: string }

export const uploadToastPanelClass =
  'fixed bottom-4 right-4 z-50 min-w-[280px] max-w-sm rounded-lg border border-border bg-background shadow-lg p-3 text-foreground'
