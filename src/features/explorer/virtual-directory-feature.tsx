import type { JSX } from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import type {
  VirtualDirectory,
  VirtualEntry,
  VirtualOpenTarget,
} from '@/lib/files/virtual-directory'
import { createHermesVirtualDirectory } from '@/features/hermes/hermes-virtual-directory'
import { HermesVirtualDirectoryModalLayer } from '@/features/hermes/HermesVirtualDirectoryModalLayer'
import type { ModalOverlayScope } from './modal-overlay-scope'
export type VirtualDirectoryFeatureOptions = Readonly<{
  currentPath: () => string
  files: () => FileItem[]
  directory: () => VirtualDirectory | undefined
  entry: (file: FileItem) => VirtualEntry | undefined
  setError: (message: string) => void
  openTarget?: (file: FileItem, target: VirtualOpenTarget) => void
}>
export type VirtualDirectoryModal = Readonly<{
  provider: string
  render: (overlayScope?: ModalOverlayScope) => JSX.Element
}>
export function createVirtualDirectoryFeature(options: VirtualDirectoryFeatureOptions) {
  const hermes = createHermesVirtualDirectory(options)
  return {
    source: hermes.source,
    read: hermes.read,
    dispose: hermes.dispose,
    snapshot: (
      state: ReturnType<typeof hermes.read>,
      directory: VirtualDirectory | undefined,
      files: readonly FileItem[],
      entry: (file: FileItem) => VirtualEntry | undefined,
    ) => {
      if (directory?.provider !== 'hermes') return undefined
      const feature = hermes.snapshot(state, { directory, files, entry })
      const modal: VirtualDirectoryModal = {
        provider: 'hermes',
        render: (overlayScope) => (
          <HermesVirtualDirectoryModalLayer model={feature.modal} overlayScope={overlayScope} />
        ),
      }
      return { ...feature, modal }
    },
  }
}
export type VirtualDirectoryFeature = NonNullable<
  ReturnType<ReturnType<typeof createVirtualDirectoryFeature>['snapshot']>
>
