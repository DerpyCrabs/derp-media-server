import { describe, expect, test } from 'bun:test'
import {
  inspectPersistedWorkspace,
  inspectSpaceWorkspaceRecovery,
  clearSpaceWorkspaceRecovery,
  defaultPersistedState,
  loadSpaceWorkspaceRecovery,
  markSpaceWorkspaceRecoveryCopy,
  persistSpaceWorkspaceRecovery,
  workspaceRecoveryCanReplay,
  workspaceSpaceRecoveryKey,
} from '@/src/workspace/workspace-page-persistence'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

describe('durable Workspace local recovery', () => {
  test('preserves an empty stored Workspace as corrupt source instead of treating it as absent', () => {
    const storage = new MemoryStorage()
    storage.setItem('workspace', '')
    expect(inspectPersistedWorkspace(storage, 'workspace')).toEqual({ kind: 'corrupt', raw: '' })
  })

  test('preserves partially valid and duplicate-window drafts as corrupt sources', () => {
    const storage = new MemoryStorage()
    const valid = defaultPersistedState({ kind: 'local', rootPath: null }).windows[0]!
    const partialRaw = JSON.stringify({
      windows: [valid, { id: 'bad-window', type: 'unknown' }],
      activeWindowId: valid.id,
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    })
    storage.setItem('partial', partialRaw)
    expect(inspectPersistedWorkspace(storage, 'partial')).toEqual({
      kind: 'corrupt',
      raw: partialRaw,
    })

    const duplicateRaw = JSON.stringify({
      windows: [valid, { ...valid }],
      activeWindowId: valid.id,
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    })
    storage.setItem('duplicate', duplicateRaw)
    expect(inspectPersistedWorkspace(storage, 'duplicate')).toEqual({
      kind: 'corrupt',
      raw: duplicateRaw,
    })
  })

  test('round-trips pending durable content and clears only its opaque Space key', () => {
    const storage = new MemoryStorage()
    const key = workspaceSpaceRecoveryKey('family/desk\\phone')
    const workspace = defaultPersistedState({ kind: 'local', rootPath: null })
    workspace.windows[0]!.initialState = { dir: 'Documents' }
    workspace.activeWindowId = workspace.windows[0]!.id

    persistSpaceWorkspaceRecovery(storage, key, workspace, 7)

    expect(key).toBe('space-recovery-workspace-family%2Fdesk%5Cphone')
    expect(loadSpaceWorkspaceRecovery(storage, key)).toMatchObject({
      baseRevision: 7,
      workspace: {
        activeWindowId: 'workspace-window-1',
        windows: [{ id: 'workspace-window-1', initialState: { dir: 'Documents' } }],
      },
    })
    const recovery = loadSpaceWorkspaceRecovery(storage, key)!
    expect(workspaceRecoveryCanReplay(recovery, 7)).toBe(true)
    expect(workspaceRecoveryCanReplay(recovery, 8)).toBe(false)
    markSpaceWorkspaceRecoveryCopy(storage, key, 'recovered-space')
    expect(loadSpaceWorkspaceRecovery(storage, key)?.recoveredSpaceId).toBe('recovered-space')

    clearSpaceWorkspaceRecovery(storage, key)
    expect(loadSpaceWorkspaceRecovery(storage, key)).toBeNull()
  })

  test('ignores malformed recovery without mutating it', () => {
    const storage = new MemoryStorage()
    storage.setItem('recovery', '{bad json')
    expect(loadSpaceWorkspaceRecovery(storage, 'recovery')).toBeNull()
    expect(storage.getItem('recovery')).toBe('{bad json')
  })

  test('quarantines partially valid recovery without dropping its rejected windows', () => {
    const storage = new MemoryStorage()
    const valid = defaultPersistedState({ kind: 'local', rootPath: null }).windows[0]!
    const raw = JSON.stringify({
      version: 1,
      baseRevision: 3,
      raw: JSON.stringify({
        windows: [valid, { id: 'rejected', type: 'unknown' }],
        activeWindowId: valid.id,
        activeTabMap: {},
        nextWindowId: 2,
        pinnedTaskbarItems: [],
      }),
    })
    storage.setItem('recovery', raw)

    expect(inspectSpaceWorkspaceRecovery(storage, 'recovery')).toEqual({ kind: 'corrupt', raw })
    expect(loadSpaceWorkspaceRecovery(storage, 'recovery')).toBeNull()
    expect(storage.getItem('recovery')).toBe(raw)
  })
})
