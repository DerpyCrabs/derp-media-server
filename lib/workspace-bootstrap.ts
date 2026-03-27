import { isVirtualFolderPath } from '@/lib/constants'
import { MediaType } from '@/lib/types'
import {
  normalizePersistedWorkspaceState,
  type PersistedWorkspaceState,
  type WorkspaceSource,
} from '@/lib/use-workspace'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'
import { createDefaultBounds, createWindowLayout } from '@/lib/workspace-geometry'
import { defaultPersistedState } from '@/src/workspace/workspace-page-persistence'

export type WorkspaceHydrationInput = {
  dirParam: string | null
  presetParam: string | null
  loaded: PersistedWorkspaceState | null
  presetsReadyNow: boolean
  presetsList: WorkspaceLayoutPreset[]
  layoutScope: string
  source: WorkspaceSource
}

export type WorkspaceHydrationInitialOutcome =
  | {
      kind: 'set-workspace'
      workspace: PersistedWorkspaceState
      baselinePresetId: string | null
      baselineSnapshot: PersistedWorkspaceState | null
      stripPresetFromUrl: boolean
    }
  | { kind: 'defer-preset' }

export function buildWorkspaceFromDirParam(
  dirParam: string,
  source: WorkspaceSource,
): PersistedWorkspaceState {
  return {
    windows: [
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: dirParam.split(/[/\\]/).filter(Boolean).pop() ?? 'Browser 1',
        iconName: null,
        iconPath: dirParam,
        iconType: MediaType.FOLDER,
        iconIsVirtual: isVirtualFolderPath(dirParam),
        source,
        initialState: { dir: dirParam },
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

function findPresetSnapshot(
  presetsList: WorkspaceLayoutPreset[],
  presetParam: string,
  layoutScope: string,
): PersistedWorkspaceState | null {
  const found = presetsList.find((p) => p.id === presetParam && p.scope === layoutScope)
  const normalized = found ? normalizePersistedWorkspaceState(found.snapshot) : null
  if (!normalized?.windows.length) return null
  return normalized
}

/**
 * Pure decision for first-time hydration when `storageSessionKey` changes.
 * Mirrors logic previously inlined in `WorkspacePage` createEffect.
 */
export function resolveWorkspaceInitialHydration(
  input: WorkspaceHydrationInput,
): WorkspaceHydrationInitialOutcome {
  const { dirParam, presetParam, loaded, presetsReadyNow, presetsList, layoutScope, source } = input

  if (dirParam != null && dirParam !== '') {
    const workspace = buildWorkspaceFromDirParam(dirParam, source)
    return {
      kind: 'set-workspace',
      workspace,
      baselinePresetId: null,
      baselineSnapshot: null,
      stripPresetFromUrl: !!presetParam,
    }
  }

  if (loaded) {
    return {
      kind: 'set-workspace',
      workspace: loaded,
      baselinePresetId: null,
      baselineSnapshot: null,
      stripPresetFromUrl: !!presetParam,
    }
  }

  if (presetParam && presetsReadyNow) {
    const normalized = findPresetSnapshot(presetsList, presetParam, layoutScope)
    if (normalized) {
      const clone = JSON.parse(JSON.stringify(normalized)) as PersistedWorkspaceState
      return {
        kind: 'set-workspace',
        workspace: normalized,
        baselinePresetId: presetParam,
        baselineSnapshot: clone,
        stripPresetFromUrl: true,
      }
    }
    return {
      kind: 'set-workspace',
      workspace: defaultPersistedState(source),
      baselinePresetId: null,
      baselineSnapshot: null,
      stripPresetFromUrl: true,
    }
  }

  if (presetParam && !presetsReadyNow) {
    return { kind: 'defer-preset' }
  }

  return {
    kind: 'set-workspace',
    workspace: defaultPersistedState(source),
    baselinePresetId: null,
    baselineSnapshot: null,
    stripPresetFromUrl: false,
  }
}

export type DeferredPresetOutcome =
  | {
      kind: 'apply'
      workspace: PersistedWorkspaceState
      baselinePresetId: string
      baselineSnapshot: PersistedWorkspaceState
      stripPresetFromUrl: true
    }
  | { kind: 'noop'; stripPresetFromUrl: true }

/**
 * When session key is unchanged, admin settings become ready, URL still has `preset`, and no draft exists in storage.
 */
export function resolveWorkspaceDeferredPresetApply(input: {
  presetParam: string | null
  presetsReadyNow: boolean
  hasPersistedDraft: boolean
  presetsList: WorkspaceLayoutPreset[]
  layoutScope: string
}): DeferredPresetOutcome | null {
  const { presetParam, presetsReadyNow, hasPersistedDraft, presetsList, layoutScope } = input
  if (!presetParam || !presetsReadyNow || hasPersistedDraft) return null
  const normalized = findPresetSnapshot(presetsList, presetParam, layoutScope)
  if (!normalized) return { kind: 'noop', stripPresetFromUrl: true }
  const clone = JSON.parse(JSON.stringify(normalized)) as PersistedWorkspaceState
  return {
    kind: 'apply',
    workspace: normalized,
    baselinePresetId: presetParam,
    baselineSnapshot: clone,
    stripPresetFromUrl: true,
  }
}
