import type { FileItem } from '@/lib/files/types'
import type { Accessor } from 'solid-js'

type ActionResult = boolean | void

export type FileBrowserActionOverrides = Readonly<{
  openCreateFile?: () => ActionResult
  rename?: (item: FileItem, name: string, close: () => void) => ActionResult
  renameExists?: (item: FileItem, name: string) => boolean | undefined
  remove?: (item: FileItem, close: () => void) => ActionResult
  renamePending?: Accessor<boolean>
  renameError?: Accessor<Error | null | undefined>
  removePending?: Accessor<boolean>
  removeTitle?: Accessor<string | undefined>
  removeDescription?: Accessor<string | undefined>
  removeConfirmLabel?: Accessor<string | undefined>
  removeTargetChanged?: (target: FileItem | null) => void
}>
