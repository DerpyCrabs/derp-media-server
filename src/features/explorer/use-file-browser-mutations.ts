import { useMutation, useQueryClient } from '@tanstack/solid-query'
import { post } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { persistViewMode } from './view-mode-persistence'

export type FilePasteVariables = {
  path: string
  content?: string
  base64Content?: string
  mode: 'create' | 'replace'
  expectedVersion?: number
}

export type FileBrowserMutationOptions = {
  onFileCreated?: (path: string) => void
  onFileSaved?: (path: string) => void
}

export function useFileBrowserMutations(options: FileBrowserMutationOptions = {}) {
  const queryClient = useQueryClient()

  const invalidateFiles = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminContent() })
  }

  const invalidateSettings = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
  }

  const renameMutation = useMutation(() => ({
    mutationFn: (vars: { oldPath: string; newPath: string }) => post('/api/files/rename', vars),
    onSettled: invalidateFiles,
  }))

  const createFileMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; content: string }) =>
      post('/api/files/create', { type: 'file', ...vars }),
    onSuccess: (_data, variables) => options.onFileCreated?.(variables.path),
    onSettled: invalidateFiles,
  }))

  const createFolderMutation = useMutation(() => ({
    mutationFn: (vars: { path: string }) =>
      post('/api/files/create', { type: 'folder', path: vars.path }),
    onSettled: invalidateFiles,
  }))

  const pasteMutation = useMutation(() => ({
    mutationFn: (vars: FilePasteVariables) =>
      post(vars.mode === 'replace' ? '/api/files/edit' : '/api/files/create', {
        ...(vars.mode === 'create' ? { type: 'file' as const } : {}),
        path: vars.path,
        content: vars.content,
        base64Content: vars.base64Content,
        expectedVersion: vars.expectedVersion,
      }),
    onSuccess: (_data, variables) => options.onFileSaved?.(variables.path),
    onSettled: invalidateFiles,
  }))

  const deleteMutation = useMutation(() => ({
    mutationFn: (path: string) => post('/api/files/delete', { path }),
    onSettled: invalidateFiles,
  }))

  const copyMutation = useMutation(() => ({
    mutationFn: (vars: { sourcePath: string; destinationDir: string }) =>
      post('/api/files/copy', vars),
    onSettled: invalidateFiles,
  }))

  const viewModeMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; viewMode: 'list' | 'grid' }) =>
      persistViewMode(vars.path, vars.viewMode),
    onSettled: invalidateSettings,
  }))

  const knowledgeBaseMutation = useMutation(() => ({
    mutationFn: (filePath: string) => post('/api/settings/knowledgeBase', { filePath }),
    onSettled: () => {
      invalidateSettings()
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminContent() })
    },
  }))

  const setCustomIconMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; iconName: string }) => post('/api/settings/icon', vars),
    onSettled: invalidateSettings,
  }))

  const removeCustomIconMutation = useMutation(() => ({
    mutationFn: (path: string) => post('/api/settings/icon/remove', { path }),
    onSettled: invalidateSettings,
  }))

  return {
    renameMutation,
    moveMutation: renameMutation,
    createFileMutation,
    createFolderMutation,
    pasteMutation,
    deleteMutation,
    copyMutation,
    viewModeMutation,
    knowledgeBaseMutation,
    setCustomIconMutation,
    removeCustomIconMutation,
  }
}
