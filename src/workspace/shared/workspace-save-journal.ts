import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import { sanitizePersistedWorkspaceState } from '@/workspace/model/use-workspace'
import { workspaceValueEquals } from '@/workspace/model/workspace-equality'
import type { WorkspaceRecord } from '@/workspace/model/workspace-registry'
import type { PendingWorkspaceSave } from './workspace-persistence'

export type WorkspaceSavePayload = {
  document: PersistedWorkspaceState
  metadata: { name: string | null; icon: string | null; iconColor: string | null }
}

type PendingSave = PendingWorkspaceSave<WorkspaceSavePayload>
type Entry = { pending: PendingSave; inFlight?: WorkspaceSavePayload }
type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function matches(record: WorkspaceRecord, payload: WorkspaceSavePayload) {
  return (
    workspaceValueEquals(record.snapshot, payload.document) &&
    (['name', 'icon', 'iconColor'] as const).every(
      (key) => (record[key] ?? null) === payload.metadata[key],
    )
  )
}

export function createWorkspaceSaveJournal(storage: JournalStorage | null, clientId: string) {
  const prefix = `workspace-pending:${clientId}:`
  function clear(id: string) {
    try {
      storage?.removeItem(prefix + id)
    } catch {}
  }

  function read(id: string): Entry | null {
    try {
      const raw = storage?.getItem(prefix + id)
      if (!raw) return null
      const entry = JSON.parse(raw) as Entry
      if (entry.pending.id !== id || !Number.isSafeInteger(entry.pending.revision)) {
        throw new Error('Invalid pending workspace')
      }
      for (const state of [entry.pending.state, ...(entry.inFlight ? [entry.inFlight] : [])]) {
        if (
          !state.metadata ||
          !(['name', 'icon', 'iconColor'] as const).every(
            (key) => state.metadata[key] === null || typeof state.metadata[key] === 'string',
          )
        )
          throw new Error('Invalid pending workspace metadata')
        sanitizePersistedWorkspaceState(state.document)
      }
      return entry
    } catch {
      clear(id)
      return null
    }
  }

  function write(id: string, entry: Entry) {
    try {
      storage?.setItem(prefix + id, JSON.stringify(entry))
    } catch {}
  }

  return {
    clear,
    enqueue(pending: PendingSave) {
      const previous = read(pending.id)
      write(pending.id, {
        pending,
        ...(previous?.inFlight ? { inFlight: previous.inFlight } : {}),
      })
    },
    started(pending: PendingSave) {
      const entry = read(pending.id)
      if (entry) write(pending.id, { ...entry, inFlight: pending.state })
    },
    acknowledged(pending: PendingSave, revision: number) {
      const entry = read(pending.id)
      if (!entry) return
      if (workspaceValueEquals(entry.pending.state, pending.state)) {
        clear(pending.id)
      } else {
        write(pending.id, { pending: { ...entry.pending, revision } })
      }
    },
    recover(record: WorkspaceRecord, editable: boolean): PendingSave | null {
      const entry = read(record.id)
      if (!entry || !editable) return null
      if (matches(record, entry.pending.state)) {
        clear(record.id)
        return null
      }
      if (
        record.revision !== entry.pending.revision &&
        !(entry.inFlight && matches(record, entry.inFlight))
      ) {
        clear(record.id)
        return null
      }
      return { ...entry.pending, revision: record.revision }
    },
  }
}
