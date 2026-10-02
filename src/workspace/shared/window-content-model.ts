import type { Snapshot } from 'effectweb'
import type { WindowDefinition } from '@/lib/models/window-model'
import type { FileIconContext } from '@/features/explorer/file-icon'
import type { WorkspaceWindowActions } from './workspace-window-actions'
import { workspaceValueEquals } from '../model/workspace-equality'

export type WindowContentDefinition = Pick<
  WindowDefinition,
  'id' | 'type' | 'title' | 'source' | 'initialState' | 'hermes'
>

export type ApplicationWindowContentProps = Readonly<{
  windowId: string
  definition: Snapshot<WindowContentDefinition> | undefined
  visible: boolean
  active: boolean
  editableFolders: readonly string[]
  knowledgeBases: readonly string[]
  fileIconContext: FileIconContext
  actions: WorkspaceWindowActions
  autoPlayVideo: boolean
}>

export function windowContentEquals(
  previous: Snapshot<ApplicationWindowContentProps>,
  next: Snapshot<ApplicationWindowContentProps>,
): boolean {
  const a = previous.definition
  const b = next.definition
  return (
    previous.windowId === next.windowId &&
    previous.visible === next.visible &&
    previous.active === next.active &&
    previous.actions === next.actions &&
    previous.autoPlayVideo === next.autoPlayVideo &&
    workspaceValueEquals(previous.editableFolders, next.editableFolders) &&
    workspaceValueEquals(previous.knowledgeBases, next.knowledgeBases) &&
    workspaceValueEquals(previous.fileIconContext, next.fileIconContext) &&
    a?.type === b?.type &&
    a?.id === b?.id &&
    a?.title === b?.title &&
    workspaceValueEquals(a?.source, b?.source) &&
    workspaceValueEquals(a?.initialState, b?.initialState) &&
    workspaceValueEquals(a?.hermes, b?.hermes)
  )
}
