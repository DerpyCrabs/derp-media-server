import { createComponent, type Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import type { FileItem } from '@/lib/files/types'
import type {
  VirtualDirectory,
  VirtualEntry,
  VirtualOpenTarget,
} from '@/lib/files/virtual-directory'
import { useHermesVirtualDirectory } from '@/features/hermes/use-hermes-virtual-directory'
import { HermesVirtualDirectoryModalLayer } from '@/features/hermes/HermesVirtualDirectoryModalLayer'
import type { ModalOverlayScope } from './modal-overlay-scope'

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

export type VirtualDirectoryFeatureOptions = Readonly<{
  currentPath: Accessor<string>
  files: Accessor<FileItem[]>
  directory: Accessor<VirtualDirectory | undefined>
  entry: (file: FileItem) => VirtualEntry | undefined
  setError: (message: string) => void
  openTarget?: (file: FileItem, target: VirtualOpenTarget) => void
}>

export type VirtualDirectoryModal = Readonly<{
  provider: string
  render: (overlayScope?: ModalOverlayScope) => JSX.Element
}>

export function useVirtualDirectoryFeature(options: VirtualDirectoryFeatureOptions) {
  const hermes = useHermesVirtualDirectory(options)
  const adapters = { hermes } as const
  const activeAdapter = () => {
    const provider = options.directory()?.provider
    return provider && provider in adapters
      ? adapters[provider as keyof typeof adapters]
      : undefined
  }
  const hermesModal: VirtualDirectoryModal = {
    provider: 'hermes',
    render: (overlayScope) =>
      createComponent(HermesVirtualDirectoryModalLayer, {
        model: hermes.modal,
        overlayScope,
      }),
  }
  return {
    entry: options.entry,
    directory: options.directory,
    open: (file: FileItem) => activeAdapter()?.open(file) ?? false,
    download: (file: FileItem) => activeAdapter()?.download(file) ?? false,
    handleAction: (...args: Parameters<typeof hermes.handleAction>) => {
      activeAdapter()?.handleAction(...args)
    },
    canCreateFolder: () => activeAdapter()?.canCreateFolder() ?? false,
    canCreateFile: () => activeAdapter()?.canCreateFile() ?? false,
    openCreateFolder: () => activeAdapter()?.openCreateFolder() ?? false,
    actionOverrides: {
      openCreateFile: () => activeAdapter()?.actionOverrides.openCreateFile?.() ?? false,
      rename: (...args: Parameters<NonNullable<FileBrowserActionOverrides['rename']>>) =>
        activeAdapter()?.actionOverrides.rename?.(...args) ?? false,
      renameExists: (
        ...args: Parameters<NonNullable<FileBrowserActionOverrides['renameExists']>>
      ) => activeAdapter()?.actionOverrides.renameExists?.(...args),
      remove: (...args: Parameters<NonNullable<FileBrowserActionOverrides['remove']>>) =>
        activeAdapter()?.actionOverrides.remove?.(...args) ?? false,
      renamePending: () => activeAdapter()?.actionOverrides.renamePending?.() ?? false,
      renameError: () => activeAdapter()?.actionOverrides.renameError?.(),
      removePending: () => activeAdapter()?.actionOverrides.removePending?.() ?? false,
      removeTitle: () => activeAdapter()?.actionOverrides.removeTitle?.(),
      removeDescription: () => activeAdapter()?.actionOverrides.removeDescription?.(),
      removeConfirmLabel: () => activeAdapter()?.actionOverrides.removeConfirmLabel?.(),
      removeTargetChanged: (target: FileItem | null) => {
        activeAdapter()?.actionOverrides.removeTargetChanged?.(target)
      },
    } satisfies FileBrowserActionOverrides,
    modal: (): VirtualDirectoryModal | undefined =>
      activeAdapter() === hermes ? hermesModal : undefined,
  }
}
