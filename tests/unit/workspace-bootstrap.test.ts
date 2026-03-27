import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import type { PersistedWorkspaceState, WorkspaceSource } from '@/lib/use-workspace'
import {
  buildWorkspaceFromDirParam,
  resolveWorkspaceDeferredPresetApply,
  resolveWorkspaceInitialHydration,
} from '@/lib/workspace-bootstrap'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'

const localSource: WorkspaceSource = { kind: 'local', rootPath: null }

function minimalPreset(
  id: string,
  scope: 'admin' | `share:${string}`,
  windows: PersistedWorkspaceState['windows'],
): WorkspaceLayoutPreset {
  const snap: PersistedWorkspaceState = {
    windows,
    activeWindowId: windows[0]?.id ?? null,
    activeTabMap: {},
    nextWindowId: 2,
    pinnedTaskbarItems: [],
  }
  return {
    id,
    name: id,
    scope,
    snapshot: snap,
    createdAt: '',
  }
}

function oneBrowserWin(id: string, source: WorkspaceSource): PersistedWorkspaceState['windows'] {
  return [
    {
      id,
      type: 'browser',
      title: id,
      iconName: null,
      iconPath: '',
      iconType: MediaType.FOLDER,
      iconIsVirtual: false,
      source,
      initialState: { dir: '/x' },
      tabGroupId: null,
      layout: { minimized: false, zIndex: 1 },
    },
  ]
}

describe('workspace-bootstrap', () => {
  test('initial: dir param opens folder window and strips preset from URL when preset also present', () => {
    const r = resolveWorkspaceInitialHydration({
      dirParam: '/foo/bar',
      presetParam: 'p1',
      loaded: null,
      presetsReadyNow: true,
      presetsList: [],
      layoutScope: 'admin',
      source: localSource,
    })
    expect(r.kind).toBe('set-workspace')
    if (r.kind !== 'set-workspace') return
    expect(r.workspace.windows).toHaveLength(1)
    expect(r.workspace.windows[0]?.initialState.dir).toBe('/foo/bar')
    expect(r.baselinePresetId).toBeNull()
    expect(r.stripPresetFromUrl).toBe(true)
  })

  test('initial: prefers localStorage draft over preset id in URL', () => {
    const loaded: PersistedWorkspaceState = {
      windows: oneBrowserWin('w-draft', localSource),
      activeWindowId: 'w-draft',
      activeTabMap: {},
      nextWindowId: 3,
      pinnedTaskbarItems: [],
    }
    const r = resolveWorkspaceInitialHydration({
      dirParam: null,
      presetParam: 'p1',
      loaded,
      presetsReadyNow: true,
      presetsList: [minimalPreset('p1', 'admin', oneBrowserWin('w-preset', localSource))],
      layoutScope: 'admin',
      source: localSource,
    })
    expect(r.kind).toBe('set-workspace')
    if (r.kind !== 'set-workspace') return
    expect(r.workspace.windows[0]?.id).toBe('w-draft')
    expect(r.stripPresetFromUrl).toBe(true)
  })

  test('initial: applies preset when no draft and presets ready', () => {
    const r = resolveWorkspaceInitialHydration({
      dirParam: null,
      presetParam: 'p1',
      loaded: null,
      presetsReadyNow: true,
      presetsList: [minimalPreset('p1', 'admin', oneBrowserWin('from-preset', localSource))],
      layoutScope: 'admin',
      source: localSource,
    })
    expect(r.kind).toBe('set-workspace')
    if (r.kind !== 'set-workspace') return
    expect(r.workspace.windows[0]?.id).toBe('from-preset')
    expect(r.baselinePresetId).toBe('p1')
    expect(r.baselineSnapshot?.windows[0]?.id).toBe('from-preset')
    expect(r.stripPresetFromUrl).toBe(true)
  })

  test('initial: invalid preset falls back to default workspace', () => {
    const r = resolveWorkspaceInitialHydration({
      dirParam: null,
      presetParam: 'missing',
      loaded: null,
      presetsReadyNow: true,
      presetsList: [minimalPreset('p1', 'admin', oneBrowserWin('x', localSource))],
      layoutScope: 'admin',
      source: localSource,
    })
    expect(r.kind).toBe('set-workspace')
    if (r.kind !== 'set-workspace') return
    expect(r.workspace.windows[0]?.id).toBe('workspace-window-1')
    expect(r.stripPresetFromUrl).toBe(true)
  })

  test('initial: preset in URL but settings not ready defers', () => {
    const r = resolveWorkspaceInitialHydration({
      dirParam: null,
      presetParam: 'p1',
      loaded: null,
      presetsReadyNow: false,
      presetsList: [],
      layoutScope: 'admin',
      source: localSource,
    })
    expect(r).toEqual({ kind: 'defer-preset' })
  })

  test('initial: share context treats presets as ready without settings query', () => {
    const r = resolveWorkspaceInitialHydration({
      dirParam: null,
      presetParam: 'p1',
      loaded: null,
      presetsReadyNow: true,
      presetsList: [minimalPreset('p1', 'share:tok', oneBrowserWin('sh', localSource))],
      layoutScope: 'share:tok',
      source: { kind: 'share', token: 'tok', sharePath: '/s' },
    })
    expect(r.kind).toBe('set-workspace')
    if (r.kind !== 'set-workspace') return
    expect(r.baselinePresetId).toBe('p1')
  })

  test('deferred: applies preset when draft absent and settings became ready', () => {
    const d = resolveWorkspaceDeferredPresetApply({
      presetParam: 'p1',
      presetsReadyNow: true,
      hasPersistedDraft: false,
      presetsList: [minimalPreset('p1', 'admin', oneBrowserWin('late', localSource))],
      layoutScope: 'admin',
    })
    expect(d?.kind).toBe('apply')
    if (!d || d.kind !== 'apply') return
    expect(d.workspace.windows[0]?.id).toBe('late')
    expect(d.baselinePresetId).toBe('p1')
  })

  test('deferred: null when persisted draft exists', () => {
    expect(
      resolveWorkspaceDeferredPresetApply({
        presetParam: 'p1',
        presetsReadyNow: true,
        hasPersistedDraft: true,
        presetsList: [minimalPreset('p1', 'admin', oneBrowserWin('late', localSource))],
        layoutScope: 'admin',
      }),
    ).toBeNull()
  })

  test('deferred: noop strips URL when preset id unknown (matches lazy applyPreset fail)', () => {
    const d = resolveWorkspaceDeferredPresetApply({
      presetParam: 'bad',
      presetsReadyNow: true,
      hasPersistedDraft: false,
      presetsList: [minimalPreset('p1', 'admin', oneBrowserWin('late', localSource))],
      layoutScope: 'admin',
    })
    expect(d).toEqual({ kind: 'noop', stripPresetFromUrl: true })
  })

  test('buildWorkspaceFromDirParam sets virtual flag from path', () => {
    const w = buildWorkspaceFromDirParam('Favorites', localSource)
    expect(w.windows[0]?.iconIsVirtual).toBe(true)
  })
})
