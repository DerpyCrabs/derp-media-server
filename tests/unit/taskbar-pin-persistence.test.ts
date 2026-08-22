import {
  applyTaskbarPinCommand,
  applyWorkspaceTransition,
  type TaskbarPinCommand,
} from '@/workspace/shared/use-workspace-page-server-data'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import type { TaskbarPin as PinnedTaskbarItem } from '@/lib/models/taskbar-pins'
import { describe, expect, test } from 'bun:test'

function pin(id: string): PinnedTaskbarItem {
  return {
    id,
    path: `Documents/${id}.txt`,
    isDirectory: false,
    title: id,
    source: { kind: 'local' },
  }
}

function apply(pins: PinnedTaskbarItem[], ...commands: TaskbarPinCommand[]) {
  return commands.reduce(applyTaskbarPinCommand, pins)
}

describe('taskbar pin commands', () => {
  test('two adds compose instead of replacing the first pin', () => {
    const result = apply(
      [],
      { kind: 'add', pin: pin('first') },
      { kind: 'add', pin: pin('second') },
    )

    expect(result.map(({ id }) => id)).toEqual(['first', 'second'])
  })

  test('remove affects only its stable pin id', () => {
    const result = apply(
      [pin('first'), pin('second')],
      { kind: 'remove', id: 'first' },
      { kind: 'add', pin: pin('third') },
    )

    expect(result.map(({ id }) => id)).toEqual(['second', 'third'])
  })

  test('reorder retains pins added by another command', () => {
    const result = apply([pin('first'), pin('second'), pin('concurrent')], {
      kind: 'reorder',
      ids: ['second', 'first'],
    })

    expect(result.map(({ id }) => id)).toEqual(['second', 'first', 'concurrent'])
  })
})

test('workspace transition command updates canonical settings state', () => {
  const settings: WorkspaceSettings = {
    viewModes: {},
    sortOrders: {},
    fileColumns: {
      media: { createdDate: true, size: true, favorite: true, views: true },
      workspace: { createdDate: true, size: true, favorite: false, views: false },
    },
    favorites: [],
    knowledgeBases: [],
    customIcons: {},
    autoSave: {},
    workspaceTransition: 'fade',
    workspaceTaskbarPins: [],
  }

  expect(applyWorkspaceTransition(settings, 'instant')).toEqual({
    ...settings,
    workspaceTransition: 'instant',
  })
  expect(applyWorkspaceTransition(settings, 'fade')).toBe(settings)
})
