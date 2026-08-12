import type { SpaceCommand } from './space'
import type { PendingSpaceCommand } from './space-client'

const SPACE_COMMAND_JOURNAL_VERSION = 1
const COMMAND_TYPES = new Set<SpaceCommand['type']>([
  'rename',
  'delete',
  'addPane',
  'removePane',
  'updatePane',
  'applyArrangement',
  'restoreRevision',
])

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isJournalCommand(value: unknown): value is SpaceCommand {
  return isRecord(value) && typeof value.type === 'string' && COMMAND_TYPES.has(value.type as never)
}

function isPendingCommand(value: unknown): value is PendingSpaceCommand {
  return (
    isRecord(value) &&
    typeof value.commandId === 'string' &&
    value.commandId.length > 0 &&
    value.commandId.length <= 128 &&
    ![...value.commandId].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    }) &&
    isJournalCommand(value.command)
  )
}

export function spaceCommandJournalStorageKey(spaceId: string): string {
  return `derp-space-command-journal-v1:${encodeURIComponent(spaceId)}`
}

export function loadSpaceCommandJournal(
  storage: StorageLike,
  spaceId: string,
): PendingSpaceCommand[] {
  try {
    const raw = storage.getItem(spaceCommandJournalStorageKey(spaceId))
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      value.version !== SPACE_COMMAND_JOURNAL_VERSION ||
      value.spaceId !== spaceId ||
      !Array.isArray(value.commands)
    ) {
      return []
    }
    return value.commands.filter(isPendingCommand).map((command) => structuredClone(command))
  } catch {
    return []
  }
}

export function saveSpaceCommandJournal(
  storage: StorageLike,
  spaceId: string,
  commands: readonly PendingSpaceCommand[],
): void {
  const key = spaceCommandJournalStorageKey(spaceId)
  try {
    if (commands.length === 0) {
      storage.removeItem(key)
      return
    }
    storage.setItem(
      key,
      JSON.stringify({
        version: SPACE_COMMAND_JOURNAL_VERSION,
        spaceId,
        commands,
      }),
    )
  } catch {}
}
