import { post } from '@/lib/api/client'
import { useServerConfigQuery, useSettingsQuery } from '@/lib/api/use-app-data'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import type { WorkspaceTransition } from '@/lib/models/settings-types'
import type { TaskbarPin as PinnedTaskbarItem } from '@/lib/models/taskbar-pins'
import { queryKeys } from '@/lib/api/query-keys'
import { useMutation, useQueryClient } from '@tanstack/solid-query'
import { createMemo, snapshot } from 'solid-js'
import { createKeyedAsyncTaskQueue } from '@/lib/async-task-queue'

function fromQueryData<T>(value: T): T {
  return structuredClone(snapshot(value))
}

export type TaskbarPinCommand =
  | { kind: 'add'; pin: PinnedTaskbarItem }
  | { kind: 'remove'; id: string }
  | { kind: 'reorder'; ids: string[] }

interface TaskbarPinsResponse {
  workspaceTaskbarPins: PinnedTaskbarItem[]
}

const settingsCommandQueue = createKeyedAsyncTaskQueue<'pins' | 'workspace-transition'>()

function postTaskbarPinCommand(command: TaskbarPinCommand): Promise<TaskbarPinsResponse> {
  const request = () => {
    switch (command.kind) {
      case 'add':
        return post<TaskbarPinsResponse>('/api/settings/workspaceTaskbarPins/add', {
          pin: command.pin,
        })
      case 'remove':
        return post<TaskbarPinsResponse>('/api/settings/workspaceTaskbarPins/remove', {
          id: command.id,
        })
      case 'reorder':
        return post<TaskbarPinsResponse>('/api/settings/workspaceTaskbarPins/reorder', {
          ids: command.ids,
        })
    }
    throw new Error('Unknown taskbar pin command')
  }
  return settingsCommandQueue.run('pins', request)
}

export function applyTaskbarPinCommand(
  pins: PinnedTaskbarItem[],
  command: TaskbarPinCommand,
): PinnedTaskbarItem[] {
  switch (command.kind) {
    case 'add': {
      const next = pins.filter((pin) => pin.id !== command.pin.id)
      next.push(fromQueryData(command.pin))
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

export function useWorkspacePageServerData() {
  const queryClient = useQueryClient()

  const settingsQuery = useSettingsQuery<WorkspaceSettings>()
  const serverConfigQuery = useServerConfigQuery()

  const editableFolders = createMemo((): string[] => {
    const folders = serverConfigQuery.data?.editableFolders
    return folders ? fromQueryData(folders) : []
  })

  const serverPinsList = createMemo((): PinnedTaskbarItem[] => {
    const settings = settingsQuery.data
    return settings ? fromQueryData(settings.workspaceTaskbarPins) : []
  })

  const pinCommandMutation = useMutation(() => ({
    mutationFn: postTaskbarPinCommand,
    onMutate: async (command: TaskbarPinCommand) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      queryClient.setQueryData<WorkspaceSettings>(queryKeys.settings(), (current) =>
        current
          ? {
              ...current,
              workspaceTaskbarPins: applyTaskbarPinCommand(
                fromQueryData(current.workspaceTaskbarPins),
                command,
              ),
            }
          : current,
      )
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const workspaceTransitionMutation = useMutation(() => ({
    mutationFn: (transition: WorkspaceTransition) =>
      settingsCommandQueue.run('workspace-transition', () =>
        post<{ workspaceTransition: WorkspaceTransition }>('/api/settings/workspaceTransition', {
          value: transition,
        }),
      ),
    onMutate: async (transition: WorkspaceTransition) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() })
      queryClient.setQueryData<WorkspaceSettings>(queryKeys.settings(), (current) =>
        current ? applyWorkspaceTransition(current, transition) : current,
      )
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  return {
    queryClient,
    settingsQuery,
    editableFolders,
    serverPinsList,
    addPin: (pin: PinnedTaskbarItem) => pinCommandMutation.mutateAsync({ kind: 'add', pin }),
    removePin: (id: string) => pinCommandMutation.mutateAsync({ kind: 'remove', id }),
    reorderPins: (ids: string[]) => pinCommandMutation.mutateAsync({ kind: 'reorder', ids }),
    setWorkspaceTransition: (transition: WorkspaceTransition) =>
      workspaceTransitionMutation.mutateAsync(transition),
    pinCommandMutation,
    workspaceTransitionMutation,
  }
}
