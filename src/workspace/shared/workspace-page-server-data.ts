import { workspaceSettingsSchema } from '@/lib/api/schemas'
import { postEffect, postSchemaEffect } from '@/lib/api/client'
import { queryCache, groups } from '@/lib/api/cache'
import { settingsQuery, configQuery } from '@/lib/api/queries'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import type { WorkspaceTransition } from '@/lib/models/settings-types'
import type { TaskbarPin as PinnedTaskbarItem } from '@/lib/models/taskbar-pins'
import { available, commandSlot, modelOwner } from 'effectweb'
import { Effect, Schema } from 'effect'
import { observeQuery } from '@effectweb/query'

export type TaskbarPinCommand =
  | { kind: 'add'; pin: PinnedTaskbarItem }
  | { kind: 'remove'; id: string }
  | { kind: 'reorder'; ids: string[] }

const taskbarPinsResponseSchema = Schema.Struct({
  workspaceTaskbarPins: workspaceSettingsSchema.fields.workspaceTaskbarPins,
})

export function applyTaskbarPinCommand(
  pins: PinnedTaskbarItem[],
  command: TaskbarPinCommand,
): PinnedTaskbarItem[] {
  switch (command.kind) {
    case 'add': {
      const next = pins.filter((pin) => pin.id !== command.pin.id)
      next.push(structuredClone(command.pin))
      return next
    }
    case 'remove':
      return pins.filter((pin) => pin.id !== command.id)
    case 'reorder': {
      const byId = new Map(pins.map((pin) => [pin.id, pin]))
      const ordered = command.ids.flatMap((id) => {
        const pin = byId.get(id)
        if (!pin) return []
        byId.delete(id)
        return [pin]
      })
      return [...ordered, ...byId.values()]
    }
  }
  throw new Error('Unknown taskbar pin command')
}

export function applyWorkspaceTransition(
  settings: WorkspaceSettings,
  transition: WorkspaceTransition,
): WorkspaceSettings {
  return settings.workspaceTransition === transition
    ? settings
    : { ...settings, workspaceTransition: transition }
}

export function createWorkspacePageServerData() {
  const owner = modelOwner({
    settings: undefined as WorkspaceSettings | undefined,
    editableFolders: [] as string[],
    pinPending: false,
    transitionPending: false,
  })
  const settings = observeQuery(owner, queryCache, settingsQuery, (result) => {
    const value = available(result)
    if (value) owner.patch({ settings: value })
  })
  const config = observeQuery(owner, queryCache, configQuery, (result) => {
    const value = available(result)
    if (value) owner.patch({ editableFolders: value.editableFolders })
  })
  settings.select(true)
  config.select(true)
  const pinsSlot = commandSlot('workspace-taskbar-pin')
  const transitionSlot = commandSlot('workspace-transition')
  const pinCommand = (command: TaskbarPinCommand) => {
    queryCache.updateQueryData(settingsQuery, true, (current) =>
      current
        ? {
            ...current,
            workspaceTaskbarPins: applyTaskbarPinCommand(
              [...current.workspaceTaskbarPins] as PinnedTaskbarItem[],
              command,
            ),
          }
        : current,
    )
    const endpoint = `/api/settings/workspaceTaskbarPins/${command.kind}`
    const body =
      command.kind === 'add'
        ? { pin: command.pin }
        : command.kind === 'remove'
          ? { id: command.id }
          : { ids: command.ids }
    owner.run(
      pinsSlot,
      Effect.sync(() => owner.patch({ pinPending: true })).pipe(
        Effect.andThen(postSchemaEffect(taskbarPinsResponseSchema, endpoint, body)),
        Effect.ensuring(
          Effect.sync(() => {
            owner.patch({ pinPending: false })
            queryCache.invalidateGroup(groups.settings)
          }),
        ),
      ),
      'queue',
    )
  }
  const setWorkspaceTransition = (transition: WorkspaceTransition) => {
    queryCache.updateQueryData(settingsQuery, true, (current) =>
      current ? { ...current, workspaceTransition: transition } : current,
    )
    owner.run(
      transitionSlot,
      Effect.sync(() => owner.patch({ transitionPending: true })).pipe(
        Effect.andThen(postEffect('/api/settings/workspaceTransition', { value: transition })),
        Effect.ensuring(
          Effect.sync(() => {
            owner.patch({ transitionPending: false })
            queryCache.invalidateGroup(groups.settings)
          }),
        ),
      ),
      'queue',
    )
  }
  return {
    source: owner.source,
    dispose: owner.dispose,
    settingsQuery: {
      get data(): WorkspaceSettings | undefined {
        return structuredClone(owner.read().settings) as WorkspaceSettings | undefined
      },
    },
    editableFolders: () => [...owner.read().editableFolders],
    serverPinsList: () =>
      structuredClone(owner.read().settings?.workspaceTaskbarPins ?? []) as PinnedTaskbarItem[],
    addPin: (pin: PinnedTaskbarItem) => pinCommand({ kind: 'add', pin }),
    removePin: (id: string) => pinCommand({ kind: 'remove', id }),
    reorderPins: (ids: string[]) => pinCommand({ kind: 'reorder', ids }),
    setWorkspaceTransition,
    pinCommandMutation: {
      get isPending() {
        return owner.read().pinPending
      },
    },
    workspaceTransitionMutation: {
      get isPending() {
        return owner.read().transitionPending
      },
    },
  }
}
