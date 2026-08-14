import { filesystemResourceAddress, type ResourceKey } from '@/lib/domain/resource'
import { normalizePersistedWorkspaceState, type PersistedWorkspaceState } from '@/lib/use-workspace'
import type { ContentWindowPersistencePort } from '@/lib/content-window-persistence'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'
import { createDefaultBounds, createWindowLayout } from '@/lib/workspace-geometry'
import { defaultPersistedState } from '@/lib/workspace-default-state'

export type WorkspaceHydrationInput = {
  resource: ResourceKey | null
  presetParam: string | null
  loaded: PersistedWorkspaceState | null
  presetsReadyNow: boolean
  presetsList: WorkspaceLayoutPreset[]
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

export function buildWorkspaceFromResource(resource: ResourceKey): PersistedWorkspaceState {
  const path = filesystemResourceAddress(resource)?.path ?? ''
  return {
    windows: [
      {
        id: 'workspace-window-1',
        title: path.split('/').filter(Boolean).pop() ?? 'Browser 1',
        iconName: null,
        contentInstance: {
          id: 'workspace-window-1',
          type: 'explorer',
          location: resource,
        },
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
  persistence: ContentWindowPersistencePort,
): PersistedWorkspaceState | null {
  const found = presetsList.find((p) => p.id === presetParam)
  const normalized = found ? normalizePersistedWorkspaceState(found.snapshot, persistence) : null
  if (!normalized?.windows.length) return null
  return normalized
}

/**
 * Pure decision for first-time hydration when `storageSessionKey` changes.
 * Mirrors logic previously inlined in `WorkspacePage` createEffect.
 */
export function resolveWorkspaceInitialHydration(
  input: WorkspaceHydrationInput,
  persistence: ContentWindowPersistencePort,
): WorkspaceHydrationInitialOutcome {
  const { resource, presetParam, loaded, presetsReadyNow, presetsList } = input

  if (resource) {
    const workspace = buildWorkspaceFromResource(resource)
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
    const normalized = findPresetSnapshot(presetsList, presetParam, persistence)
    if (normalized) {
      const workspace = structuredClone(normalized)
      return {
        kind: 'set-workspace',
        workspace,
        baselinePresetId: presetParam,
        baselineSnapshot: structuredClone(workspace),
        stripPresetFromUrl: true,
      }
    }
    return {
      kind: 'set-workspace',
      workspace: defaultPersistedState(),
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
    workspace: defaultPersistedState(),
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
 * When session key is unchanged, settings become ready, URL still has `preset`, and no draft exists in storage.
 */
export function resolveWorkspaceDeferredPresetApply(
  input: {
    presetParam: string | null
    presetsReadyNow: boolean
    hasPersistedDraft: boolean
    presetsList: WorkspaceLayoutPreset[]
  },
  persistence: ContentWindowPersistencePort,
): DeferredPresetOutcome | null {
  const { presetParam, presetsReadyNow, hasPersistedDraft, presetsList } = input
  if (!presetParam || !presetsReadyNow || hasPersistedDraft) return null
  const normalized = findPresetSnapshot(presetsList, presetParam, persistence)
  if (!normalized) return { kind: 'noop', stripPresetFromUrl: true }
  const workspace = structuredClone(normalized)
  return {
    kind: 'apply',
    workspace,
    baselinePresetId: presetParam,
    baselineSnapshot: structuredClone(workspace),
    stripPresetFromUrl: true,
  }
}
