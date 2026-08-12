import { describe, expect, test } from 'bun:test'
import {
  loadSpaceCommandJournal,
  saveSpaceCommandJournal,
  spaceCommandJournalStorageKey,
} from '@/lib/space-command-journal'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  }
}

describe('Space command journal', () => {
  test('round-trips pending durable commands and clears when saved', () => {
    const storage = memoryStorage()
    const commands = [
      { commandId: 'command-1', command: { type: 'rename' as const, name: 'Desk' } },
      {
        commandId: 'command-2',
        command: { type: 'removePane' as const, paneId: 'old-pane' },
      },
    ]

    saveSpaceCommandJournal(storage, 'space / one', commands)
    expect(loadSpaceCommandJournal(storage, 'space / one')).toEqual(commands)
    expect(storage.values.has(spaceCommandJournalStorageKey('space / one'))).toBe(true)

    saveSpaceCommandJournal(storage, 'space / one', [])
    expect(loadSpaceCommandJournal(storage, 'space / one')).toEqual([])
  })

  test('ignores another Space, malformed data, and non-replayable commands', () => {
    const storage = memoryStorage()
    const key = spaceCommandJournalStorageKey('space-1')
    storage.setItem(
      key,
      JSON.stringify({
        version: 1,
        spaceId: 'space-1',
        commands: [
          { commandId: 'command-1', command: { type: 'rename', name: 'Kept' } },
          { commandId: 'command-2', command: { type: 'restoreRevision', revision: 2 } },
          { commandId: 'command-3', command: { type: 'duplicate', newId: 'copy' } },
          { commandId: 'command-4', command: { type: 'unknown' } },
          { commandId: '', command: { type: 'rename', name: 'No ID' } },
          null,
        ],
      }),
    )
    expect(loadSpaceCommandJournal(storage, 'space-1')).toEqual([
      { commandId: 'command-1', command: { type: 'rename', name: 'Kept' } },
      { commandId: 'command-2', command: { type: 'restoreRevision', revision: 2 } },
    ])
    expect(loadSpaceCommandJournal(storage, 'space-2')).toEqual([])

    storage.setItem(key, '{broken')
    expect(loadSpaceCommandJournal(storage, 'space-1')).toEqual([])
  })
})
