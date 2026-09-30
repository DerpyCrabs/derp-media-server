import type { FileItem } from '@/lib/files/types'
type ActionResult = boolean | void
export type FileBrowserActionOverrides = Readonly<{
  openCreateFile?: () => ActionResult
  rename?: (item: FileItem, name: string, close: () => void) => ActionResult
  renameExists?: (item: FileItem, name: string) => boolean | undefined
  remove?: (item: FileItem, close: () => void) => ActionResult
  renamePending?: boolean
  renameError?: Error | null | undefined
  removePending?: boolean
  removeTitle?: string | undefined
  removeDescription?: string | undefined
  removeConfirmLabel?: string | undefined
  removeTargetChanged?: (target: FileItem | null) => void
}>
