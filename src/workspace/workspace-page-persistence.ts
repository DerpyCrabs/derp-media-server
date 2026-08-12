import { MediaType } from '@/lib/types'
import { workspaceBrowserDirTitle } from '@/lib/workspace-browser-dir-title'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
  type PersistedWorkspaceState,
  type WorkspaceSource,
} from '@/lib/use-workspace'
import { getWorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'
import { createDefaultBounds, createWindowLayout } from '@/lib/workspace-geometry'

export const DEFAULT_WORKSPACE_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }

export function isWorkspaceRoute(pathname: string) {
  return pathname === '/workspace' || /^\/share\/[^/]+\/workspace\/?$/.test(pathname)
}

/** First browser tab label when opening workspace (share root → folder name, e.g. "Work"). */
export function defaultInitialBrowserTitle(source: WorkspaceSource): string {
  if (source.kind === 'share') return workspaceBrowserDirTitle(source.sharePath ?? '')
  return 'Browser 1'
}

export function defaultPersistedState(source: WorkspaceSource): PersistedWorkspaceState {
  return {
    windows: [
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: defaultInitialBrowserTitle(source),
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source,
        initialState: {},
        tabGroupId: null,
        layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
      },
    ],
    activeWindowId: 'workspace-window-1',
    activeTabMap: {},
    nextWindowId: 2,
    pinnedTaskbarItems: [],
  }
}

export function persistWorkspaceState(storageKey: string, state: PersistedWorkspaceState) {
  try {
    const toStore: PersistedWorkspaceState = {
      ...state,
      pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
      fileOpenTarget: state.fileOpenTarget ?? getWorkspaceFileOpenTarget(),
    }
    localStorage.setItem(storageKey, serializeWorkspacePersistedState(toStore))
  } catch {}
}

export function loadPersisted(storageKey: string): PersistedWorkspaceState | null {
  const result = inspectPersistedWorkspace(localStorage, storageKey)
  return result.kind === 'loaded' ? result.workspace : null
}

export type PersistedWorkspaceInspection =
  | { kind: 'missing' }
  | { kind: 'loaded'; workspace: PersistedWorkspaceState }
  | { kind: 'corrupt'; raw: string }

function normalizeCompleteWorkspace(source: unknown): PersistedWorkspaceState | null {
  const workspace = normalizePersistedWorkspaceState(source, {
    reconcileSnapZones: false,
  })
  if (!workspace || !source || typeof source !== 'object' || Array.isArray(source)) return null
  const rawWindows = (source as { windows?: unknown }).windows
  if (
    !Array.isArray(rawWindows) ||
    rawWindows.length !== workspace.windows.length ||
    new Set(workspace.windows.map((window) => window.id)).size !== workspace.windows.length
  ) {
    return null
  }
  return workspace
}

export function inspectPersistedWorkspace(
  storage: Pick<Storage, 'getItem'>,
  storageKey: string,
): PersistedWorkspaceInspection {
  const raw = storage.getItem(storageKey)
  if (raw === null) return { kind: 'missing' }
  try {
    const source = JSON.parse(raw) as unknown
    const workspace = normalizeCompleteWorkspace(source)
    if (!workspace) return { kind: 'corrupt', raw }
    return { kind: 'loaded', workspace }
  } catch {
    return { kind: 'corrupt', raw }
  }
}

const SPACE_WORKSPACE_RECOVERY_VERSION = 1

export type SpaceWorkspaceRecovery = {
  baseRevision: number
  workspace: PersistedWorkspaceState
  recoveredSpaceId?: string
}

export type SpaceWorkspaceRecoveryInspection =
  | { kind: 'missing' }
  | { kind: 'loaded'; recovery: SpaceWorkspaceRecovery }
  | { kind: 'corrupt'; raw: string }

export function workspaceSpaceRecoveryKey(spaceId: string): string {
  return `space-recovery-workspace-${encodeURIComponent(spaceId)}`
}

export function persistSpaceWorkspaceRecovery(
  storage: Pick<Storage, 'setItem'>,
  storageKey: string,
  state: PersistedWorkspaceState,
  baseRevision: number,
) {
  try {
    storage.setItem(
      storageKey,
      JSON.stringify({
        version: SPACE_WORKSPACE_RECOVERY_VERSION,
        baseRevision,
        raw: serializeWorkspacePersistedState(state),
      }),
    )
  } catch {}
}

export function inspectSpaceWorkspaceRecovery(
  storage: Pick<Storage, 'getItem'>,
  storageKey: string,
): SpaceWorkspaceRecoveryInspection {
  const stored = storage.getItem(storageKey)
  if (stored === null) return { kind: 'missing' }
  try {
    const envelope = JSON.parse(stored) as {
      version?: unknown
      baseRevision?: unknown
      raw?: unknown
      recoveredSpaceId?: unknown
    }
    if (
      envelope.version !== SPACE_WORKSPACE_RECOVERY_VERSION ||
      !Number.isSafeInteger(envelope.baseRevision) ||
      Number(envelope.baseRevision) < 1 ||
      typeof envelope.raw !== 'string'
    ) {
      return { kind: 'corrupt', raw: stored }
    }
    const workspace = normalizeCompleteWorkspace(JSON.parse(envelope.raw))
    if (
      !workspace ||
      (envelope.recoveredSpaceId !== undefined &&
        (typeof envelope.recoveredSpaceId !== 'string' || !envelope.recoveredSpaceId))
    ) {
      return { kind: 'corrupt', raw: stored }
    }
    return {
      kind: 'loaded',
      recovery: {
        baseRevision: Number(envelope.baseRevision),
        workspace,
        ...(typeof envelope.recoveredSpaceId === 'string'
          ? { recoveredSpaceId: envelope.recoveredSpaceId }
          : {}),
      },
    }
  } catch {
    return { kind: 'corrupt', raw: stored }
  }
}

export function loadSpaceWorkspaceRecovery(
  storage: Pick<Storage, 'getItem'>,
  storageKey: string,
): SpaceWorkspaceRecovery | null {
  const inspection = inspectSpaceWorkspaceRecovery(storage, storageKey)
  return inspection.kind === 'loaded' ? inspection.recovery : null
}

export function clearSpaceWorkspaceRecovery(
  storage: Pick<Storage, 'removeItem'>,
  storageKey: string,
) {
  try {
    storage.removeItem(storageKey)
  } catch {}
}

export function workspaceRecoveryCanReplay(
  recovery: SpaceWorkspaceRecovery,
  currentRevision: number,
): boolean {
  return recovery.baseRevision === currentRevision
}

export function markSpaceWorkspaceRecoveryCopy(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  storageKey: string,
  recoveredSpaceId: string,
) {
  try {
    const stored = storage.getItem(storageKey)
    if (!stored) return
    const envelope = JSON.parse(stored) as Record<string, unknown>
    if (envelope.version !== SPACE_WORKSPACE_RECOVERY_VERSION) return
    storage.setItem(storageKey, JSON.stringify({ ...envelope, recoveredSpaceId }))
  } catch {}
}
