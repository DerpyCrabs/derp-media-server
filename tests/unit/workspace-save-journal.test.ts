import { expect, test } from 'bun:test'
import { createWorkspaceSaveJournal } from '@/workspace/shared/workspace-save-journal'
import type { WorkspaceSavePayload } from '@/workspace/shared/workspace-save-journal'
import type { WorkspaceRecord } from '@/workspace/model/workspace-registry'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

function payload(seed: string): WorkspaceSavePayload {
  return {
    document: {
      workspaceType: 'desktop',
      windows: [
        {
          id: 'viewer',
          type: 'viewer',
          title: 'photo.jpg',
          source: { kind: 'local' },
          initialState: { dir: 'Images', viewing: 'Images/photo.jpg', imageSeed: seed },
        },
      ],
      activeWindowId: 'viewer',
      activeTabMap: {},
      nextWindowId: 2,
    },
    metadata: { name: null, icon: null, iconColor: null },
  }
}

function record(state: WorkspaceSavePayload, revision = 1): WorkspaceRecord {
  return {
    id: 'workspace',
    snapshot: state.document,
    revision,
    updatedAt: 1,
    lastOpenedAt: 1,
  }
}

test('reload recovers the latest queued shuffle and an older acknowledgement cannot erase it', () => {
  const disk = storage()
  const journal = createWorkspaceSaveJournal(disk, 'tab')
  const first = { id: 'workspace', state: payload('first'), revision: 1 }
  const latest = { ...first, state: payload('latest') }
  journal.enqueue(first)
  journal.started(first)
  journal.enqueue(latest)
  const reloaded = createWorkspaceSaveJournal(disk, 'tab')
  expect(
    reloaded.recover(record(payload('original')), true)?.state.document.windows[0]?.initialState
      .imageSeed,
  ).toBe('latest')
  journal.acknowledged(first, 2)
  expect(
    reloaded.recover(record(first.state, 2), true)?.state.document.windows[0]?.initialState
      .imageSeed,
  ).toBe('latest')
  journal.acknowledged(latest, 3)
  expect(reloaded.recover(record(latest.state, 3), true)).toBeNull()
})

test('recovers a queued shuffle when the previous request reached the server before reload', () => {
  const journal = createWorkspaceSaveJournal(storage(), 'tab')
  const first = { id: 'workspace', state: payload('first'), revision: 1 }
  journal.enqueue(first)
  journal.started(first)
  journal.enqueue({ ...first, state: payload('latest') })
  const recovered = journal.recover(record(first.state, 2), true)
  expect(recovered?.revision).toBe(2)
  expect(recovered?.state.document.windows[0]?.initialState.imageSeed).toBe('latest')
})

test('never replaces a newer unrelated server edit or a read-only workspace', () => {
  const journal = createWorkspaceSaveJournal(storage(), 'tab')
  const pending = { id: 'workspace', state: payload('local'), revision: 1 }
  journal.enqueue(pending)
  expect(journal.recover(record(payload('original')), false)).toBeNull()
  expect(journal.recover(record(payload('other-tab'), 2), true)).toBeNull()
  expect(journal.recover(record(payload('original')), true)).toBeNull()
})

test('isolates tabs and workspaces and clears accepted saves and deleted workspaces', () => {
  const disk = storage()
  const journal = createWorkspaceSaveJournal(disk, 'tab')
  const pending = { id: 'workspace', state: payload('local'), revision: 1 }
  journal.enqueue(pending)
  expect(
    createWorkspaceSaveJournal(disk, 'another-tab').recover(record(payload('original')), true),
  ).toBeNull()
  expect(
    journal.recover({ ...record(payload('original')), id: 'other-workspace' }, true),
  ).toBeNull()
  expect(journal.recover(record(pending.state, 2), true)).toBeNull()
  expect(journal.recover(record(payload('original')), true)).toBeNull()
  journal.enqueue(pending)
  journal.clear('workspace')
  expect(journal.recover(record(payload('original')), true)).toBeNull()
})

test('ignores corrupted temporary state', () => {
  const disk = storage()
  disk.setItem('workspace-pending:tab:workspace', '{broken')
  const journal = createWorkspaceSaveJournal(disk, 'tab')
  expect(journal.recover(record(payload('original')), true)).toBeNull()
  expect(disk.getItem('workspace-pending:tab:workspace')).toBeNull()
})
