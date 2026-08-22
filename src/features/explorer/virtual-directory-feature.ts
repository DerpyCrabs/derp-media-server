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
import type { FileBrowserActionOverrides } from './file-browser-action-overrides'
import type { ModalOverlayScope } from './modal-overlay-scope'

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
  const activeHermes = () => (options.directory()?.provider === 'hermes' ? hermes : undefined)
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
    open: (file: FileItem) => activeHermes()?.open(file) ?? false,
    download: (file: FileItem) => activeHermes()?.download(file) ?? false,
    handleAction: (...args: Parameters<typeof hermes.handleAction>) => {
      activeHermes()?.handleAction(...args)
    },
    canCreateFolder: () => activeHermes()?.canCreateFolder() ?? false,
    canCreateFile: () => activeHermes()?.canCreateFile() ?? false,
    openCreateFolder: () => activeHermes()?.openCreateFolder() ?? false,
    actionOverrides: {
      openCreateFile: () => activeHermes()?.actionOverrides.openCreateFile?.() ?? false,
      rename: (...args: Parameters<NonNullable<FileBrowserActionOverrides['rename']>>) =>
        activeHermes()?.actionOverrides.rename?.(...args) ?? false,
      renameExists: (
        ...args: Parameters<NonNullable<FileBrowserActionOverrides['renameExists']>>
      ) => activeHermes()?.actionOverrides.renameExists?.(...args),
      remove: (...args: Parameters<NonNullable<FileBrowserActionOverrides['remove']>>) =>
        activeHermes()?.actionOverrides.remove?.(...args) ?? false,
      renamePending: () => activeHermes()?.actionOverrides.renamePending?.() ?? false,
      renameError: () => activeHermes()?.actionOverrides.renameError?.(),
      removePending: () => activeHermes()?.actionOverrides.removePending?.() ?? false,
      removeTitle: () => activeHermes()?.actionOverrides.removeTitle?.(),
      removeDescription: () => activeHermes()?.actionOverrides.removeDescription?.(),
      removeConfirmLabel: () => activeHermes()?.actionOverrides.removeConfirmLabel?.(),
      removeTargetChanged: (target: FileItem | null) => {
        activeHermes()?.actionOverrides.removeTargetChanged?.(target)
      },
    } satisfies FileBrowserActionOverrides,
    modal: (): VirtualDirectoryModal | undefined => (activeHermes() ? hermesModal : undefined),
  }
}
