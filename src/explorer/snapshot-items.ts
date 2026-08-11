import {
  explorerItemKey,
  type ExplorerCapability,
  type ExplorerItem,
  type ExplorerSnapshot,
} from '@/lib/explorer-model'
import type { FileItem } from '@/lib/types'
import { resourceForFileItem } from '../lib/legacy-resource-adapter'

export function explorerItemForFile(
  snapshot: ExplorerSnapshot,
  file: FileItem,
): ExplorerItem | undefined {
  const key = explorerItemKey(resourceForFileItem(file).ref)
  return snapshot.items.find((item) => item.key === key || item.file.path === file.path)
}

export function explorerCapabilitiesForFile(
  snapshot: ExplorerSnapshot,
  file: FileItem,
): readonly ExplorerCapability[] {
  return explorerItemForFile(snapshot, file)?.capabilities ?? []
}
