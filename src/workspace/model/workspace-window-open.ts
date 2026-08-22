import { isVirtualFolderPath } from '@/lib/files/constants'
import { directoryTitle } from '@/lib/files/directory-title'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import { MediaType, type FileItem } from '@/lib/files/types'
import type { HermesOpenTarget } from '@/features/hermes/hermes-open-target'
import type {
  WindowDefinition as WorkspaceWindowDefinition,
  WindowLayout as WorkspaceWindowLayout,
  WindowSource as WorkspaceSource,
} from '@/lib/models/window-model'
import type { PersistedWorkspaceState } from './use-workspace'

type WorkspaceOpenIdentity = {
  source: WorkspaceSource
  openedFromWindowId?: string | null
  tabGroupId?: string | null
}

export type WorkspaceBrowserOpenIntent = WorkspaceOpenIdentity & {
  kind: 'browser'
  dir: string
  title?: string
}

export type WorkspaceViewerOpenIntent = WorkspaceOpenIdentity & {
  kind: 'viewer'
  file: FileItem
  dir?: string | null
}

export type WorkspaceReaderOpenIntent = WorkspaceOpenIdentity & {
  kind: 'reader'
  file: FileItem
  readerKind: 'pdf' | 'folder' | 'book'
  dir?: string | null
}

export type WorkspaceHermesOpenIntent = WorkspaceOpenIdentity & {
  kind: 'hermes'
  file: FileItem
  target: HermesOpenTarget
  draftId?: string
}

export type WorkspaceWindowOpenIntent =
  | WorkspaceBrowserOpenIntent
  | WorkspaceViewerOpenIntent
  | WorkspaceReaderOpenIntent
  | WorkspaceHermesOpenIntent

export type WorkspaceWindowOpenPlan =
  | { kind: 'existing'; windowId: string }
  | { kind: 'create'; definition: WorkspaceWindowDefinition }

export const DEFAULT_WORKSPACE_BROWSER_TITLE = 'Browser 1'

export function workspaceWindowId(nextWindowId: number): string {
  return `workspace-window-${nextWindowId}`
}

export function workspaceSourceEquals(a: WorkspaceSource, b: WorkspaceSource): boolean {
  return a.kind === b.kind && (a.rootPath ?? null) === (b.rootPath ?? null)
}

function existingWindowForIntent(
  windows: readonly WorkspaceWindowDefinition[],
  intent: WorkspaceWindowOpenIntent,
): WorkspaceWindowDefinition | undefined {
  if (intent.kind === 'hermes') {
    if (!intent.target.sessionId) return undefined
    return windows.find(
      (window) => window.type === 'hermes' && window.hermes?.sessionId === intent.target.sessionId,
    )
  }

  if (intent.kind === 'browser') {
    return windows.find(
      (window) =>
        window.type === 'browser' &&
        window.initialState.dir === intent.dir &&
        workspaceSourceEquals(window.source, intent.source),
    )
  }

  const readerKind = intent.kind === 'reader' ? intent.readerKind : null
  return windows.find(
    (window) =>
      window.type === 'viewer' &&
      window.initialState.viewing === intent.file.path &&
      (window.initialState.readerKind ?? null) === readerKind &&
      workspaceSourceEquals(window.source, intent.source),
  )
}

function sharedDefinitionFields(
  id: string,
  intent: WorkspaceWindowOpenIntent,
  layout: WorkspaceWindowLayout | undefined,
) {
  return {
    id,
    iconName: null,
    source: intent.source,
    tabGroupId: intent.tabGroupId ?? null,
    ...(intent.openedFromWindowId ? { openedFromWindowId: intent.openedFromWindowId } : {}),
    ...(layout ? { layout } : {}),
  }
}

export function createWorkspaceWindowDefinition(options: {
  id: string
  intent: WorkspaceWindowOpenIntent
  layout?: WorkspaceWindowLayout
}): WorkspaceWindowDefinition {
  const { id, intent, layout } = options
  const shared = sharedDefinitionFields(id, intent, layout)
  if (intent.kind === 'browser') {
    return {
      ...shared,
      type: 'browser',
      title: intent.title ?? directoryTitle(intent.dir),
      iconPath: intent.dir,
      iconType: MediaType.FOLDER,
      iconIsVirtual: isVirtualFolderPath(intent.dir),
      initialState: intent.dir ? { dir: intent.dir } : {},
    }
  }

  if (intent.kind === 'hermes') {
    return {
      ...shared,
      type: 'hermes',
      title:
        intent.target.type === 'hermesDraft'
          ? 'New Hermes session'
          : intent.file.name || 'Hermes session',
      iconPath: intent.file.path,
      iconType: MediaType.OTHER,
      iconIsVirtual: true,
      initialState: {},
      hermes: {
        sessionId: intent.target.sessionId,
        draftId: intent.target.type === 'hermesDraft' ? intent.draftId : undefined,
        cwd: intent.target.projectPath,
        readOnly: intent.target.readOnly,
      },
    }
  }

  const readerKind = intent.kind === 'reader' ? intent.readerKind : undefined
  return {
    ...shared,
    type: 'viewer',
    title: intent.file.name || fileNameFromPath(intent.file.path),
    iconPath: intent.file.path,
    iconType: intent.file.type,
    iconIsVirtual: false,
    initialState: {
      dir: intent.dir !== undefined ? intent.dir : parentPath(intent.file.path),
      viewing: intent.file.path,
      ...(readerKind ? { readerKind } : {}),
    },
  }
}

export function planWorkspaceWindowOpen(options: {
  windows: readonly WorkspaceWindowDefinition[]
  id: string
  reuseExisting: boolean
  intent: WorkspaceWindowOpenIntent
  layout?: WorkspaceWindowLayout
}): WorkspaceWindowOpenPlan {
  if (options.reuseExisting) {
    const existing = existingWindowForIntent(options.windows, options.intent)
    if (existing) return { kind: 'existing', windowId: existing.id }
  }

  return {
    kind: 'create',
    definition: createWorkspaceWindowDefinition(options),
  }
}

export function appendWorkspaceWindow(
  state: PersistedWorkspaceState,
  definition: WorkspaceWindowDefinition,
  options?: { groupSourceWindowId?: string },
): PersistedWorkspaceState {
  const windows = state.windows.map((window) =>
    options?.groupSourceWindowId === window.id && !window.tabGroupId
      ? { ...window, tabGroupId: definition.tabGroupId ?? window.id }
      : window,
  )
  return {
    ...state,
    windows: [...windows, definition],
    nextWindowId: state.nextWindowId + 1,
    activeWindowId: definition.id,
    activeTabMap: definition.tabGroupId
      ? { ...state.activeTabMap, [definition.tabGroupId]: definition.id }
      : state.activeTabMap,
  }
}
