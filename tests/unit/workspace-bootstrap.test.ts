import { describe, expect, test } from 'bun:test'
import { currentContentWindowPersistence } from '@/src/integrations/current-window-content'
import { filesystemResourceAddress, filesystemResourceKey } from '@/lib/domain/resource'
import {
  normalizePersistedWorkspaceState as normalizePersistedWorkspaceStateWithPersistence,
  serializeWorkspacePersistedState as serializeWorkspacePersistedStateWithPersistence,
  type NormalizePersistedWorkspaceOptions,
  type PersistedWorkspaceState,
} from '@/lib/use-workspace'
import {
  buildWorkspaceFromResource,
  resolveWorkspaceDeferredPresetApply as resolveWorkspaceDeferredPresetApplyWithPersistence,
  resolveWorkspaceInitialHydration as resolveWorkspaceInitialHydrationWithPersistence,
} from '@/lib/workspace-bootstrap'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'

const serializeWorkspacePersistedState = (state: PersistedWorkspaceState) =>
  serializeWorkspacePersistedStateWithPersistence(state, currentContentWindowPersistence)
const normalizePersistedWorkspaceState = (
  value: unknown,
  options?: NormalizePersistedWorkspaceOptions,
) =>
  normalizePersistedWorkspaceStateWithPersistence(value, currentContentWindowPersistence, options)
const resolveWorkspaceInitialHydration = (
  input: Parameters<typeof resolveWorkspaceInitialHydrationWithPersistence>[0],
) => resolveWorkspaceInitialHydrationWithPersistence(input, currentContentWindowPersistence)
const resolveWorkspaceDeferredPresetApply = (
  input: Parameters<typeof resolveWorkspaceDeferredPresetApplyWithPersistence>[0],
) => resolveWorkspaceDeferredPresetApplyWithPersistence(input, currentContentWindowPersistence)

function minimalPreset(
  id: string,
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
    snapshot: JSON.parse(serializeWorkspacePersistedState(snap)) as PersistedWorkspaceState,
    createdAt: '',
  }
}

function oneBrowserWin(id: string): PersistedWorkspaceState['windows'] {
  return [
    {
      id,
      title: id,
      iconName: null,
      contentInstance: {
        id,
        type: 'explorer',
        location: filesystemResourceKey('configured-default', 'x'),
      },
      tabGroupId: null,
      layout: { minimized: false, zIndex: 1 },
    },
  ]
}

describe('workspace-bootstrap', () => {
  test('initial: route resource opens folder window and strips preset when also present', () => {
    const r = resolveWorkspaceInitialHydration({
      resource: filesystemResourceKey('configured-default', 'foo/bar'),
      presetParam: 'p1',
      loaded: null,
      presetsReadyNow: true,
      presetsList: [],
    })
    expect(r.kind).toBe('set-workspace')
    if (r.kind !== 'set-workspace') return
    expect(r.workspace.windows).toHaveLength(1)
    const content = r.workspace.windows[0]?.contentInstance
    expect(
      content?.type === 'explorer' ? filesystemResourceAddress(content.location)?.path : null,
    ).toBe('foo/bar')
    expect(r.baselinePresetId).toBeNull()
    expect(r.stripPresetFromUrl).toBe(true)
  })

  test('initial: prefers localStorage draft over preset id in URL', () => {
    const loaded: PersistedWorkspaceState = {
      windows: oneBrowserWin('w-draft'),
      activeWindowId: 'w-draft',
      activeTabMap: {},
      nextWindowId: 3,
      pinnedTaskbarItems: [],
    }
    const r = resolveWorkspaceInitialHydration({
      resource: null,
      presetParam: 'p1',
      loaded,
      presetsReadyNow: true,
      presetsList: [minimalPreset('p1', oneBrowserWin('w-preset'))],
    })
    expect(r.kind).toBe('set-workspace')
    if (r.kind !== 'set-workspace') return
    expect(r.workspace.windows[0]?.id).toBe('w-draft')
    expect(r.stripPresetFromUrl).toBe(true)
  })

  test('initial: applies preset when no draft and presets ready', () => {
    const presetsList = [minimalPreset('p1', oneBrowserWin('from-preset'))]
    const r = resolveWorkspaceInitialHydration({
      resource: null,
      presetParam: 'p1',
      loaded: null,
      presetsReadyNow: true,
      presetsList,
    })
    expect(r.kind).toBe('set-workspace')
    if (r.kind !== 'set-workspace') return
    expect(r.workspace.windows[0]?.id).toBe('from-preset')
    expect(r.baselinePresetId).toBe('p1')
    expect(r.baselineSnapshot?.windows[0]?.id).toBe('from-preset')
    expect(r.stripPresetFromUrl).toBe(true)
    expect(r.workspace).not.toBe(presetsList[0]!.snapshot)
    expect(r.workspace.windows).not.toBe(presetsList[0]!.snapshot.windows)
  })

  test('initial: invalid preset falls back to default workspace', () => {
    const r = resolveWorkspaceInitialHydration({
      resource: null,
      presetParam: 'missing',
      loaded: null,
      presetsReadyNow: true,
      presetsList: [minimalPreset('p1', oneBrowserWin('x'))],
    })
    expect(r.kind).toBe('set-workspace')
    if (r.kind !== 'set-workspace') return
    expect(r.workspace.windows[0]?.id).toBe('workspace-window-1')
    expect(r.stripPresetFromUrl).toBe(true)
  })

  test('initial: preset in URL but settings not ready defers', () => {
    const r = resolveWorkspaceInitialHydration({
      resource: null,
      presetParam: 'p1',
      loaded: null,
      presetsReadyNow: false,
      presetsList: [],
    })
    expect(r).toEqual({ kind: 'defer-preset' })
  })

  test('deferred: applies preset when draft absent and settings became ready', () => {
    const d = resolveWorkspaceDeferredPresetApply({
      presetParam: 'p1',
      presetsReadyNow: true,
      hasPersistedDraft: false,
      presetsList: [minimalPreset('p1', oneBrowserWin('late'))],
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
        presetsList: [minimalPreset('p1', oneBrowserWin('late'))],
      }),
    ).toBeNull()
  })

  test('deferred: noop strips URL when preset id unknown (matches lazy applyPreset fail)', () => {
    const d = resolveWorkspaceDeferredPresetApply({
      presetParam: 'bad',
      presetsReadyNow: true,
      hasPersistedDraft: false,
      presetsList: [minimalPreset('p1', oneBrowserWin('late'))],
    })
    expect(d).toEqual({ kind: 'noop', stripPresetFromUrl: true })
  })

  test('buildWorkspaceFromResource creates an authoritative Explorer location', () => {
    const w = buildWorkspaceFromResource(
      filesystemResourceKey('application-collections', 'favorites'),
    )
    const content = w.windows[0]?.contentInstance
    expect(content?.type === 'explorer' ? content.location : null).toEqual(
      filesystemResourceKey('application-collections', 'favorites'),
    )
  })

  test('fresh default workspace writes and restores current content envelopes', () => {
    const result = resolveWorkspaceInitialHydration({
      resource: null,
      presetParam: null,
      loaded: null,
      presetsReadyNow: true,
      presetsList: [],
    })
    expect(result.kind).toBe('set-workspace')
    if (result.kind !== 'set-workspace') return

    const encoded = serializeWorkspacePersistedState(result.workspace)
    expect(JSON.parse(encoded).windows[0]).toHaveProperty('content')
    expect(normalizePersistedWorkspaceState(JSON.parse(encoded))).not.toBeNull()
  })
})
