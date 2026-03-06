import { useMutation, useQueryClient } from '@tanstack/react-query'
import { post } from '@/lib/api'
import { useUrlState } from '@/lib/use-url-state'
import { queryKeys } from '@/lib/query-keys'

interface FileMutationOptions {
  inKb?: boolean
  onNavigateToFolder?: (path: string | null) => void
  onViewFile?: (path: string) => void
}

export function useFileMutations(currentPath: string, options?: FileMutationOptions) {
  const queryClient = useQueryClient()
  const urlSession = useUrlState()
  const navigateToFolder = options?.onNavigateToFolder ?? urlSession.navigateToFolder
  const viewFile = options?.onViewFile ?? urlSession.viewFile
  const inKb = options?.inKb ?? false

  const _createFolder = useMutation({
    mutationFn: (vars: { type: 'folder'; path: string }) => post('/api/files/create', vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  })

  const _createFile = useMutation({
    mutationFn: (vars: { type: 'file'; path: string; content: string }) =>
      post('/api/files/create', vars),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      viewFile(variables.path)
    },
  })

  const _deleteFolder = useMutation({
    mutationFn: (vars: { path: string }) => post('/api/files/delete', vars),
    onSuccess: () => {
      const pathParts = currentPath.split(/[/\\]/).filter(Boolean)
      if (pathParts.length > 1) {
        navigateToFolder(pathParts.slice(0, -1).join('/'))
      } else {
        navigateToFolder(null)
      }
    },
  })

  const _deleteItem = useMutation({
    mutationFn: (vars: { path: string }) => post('/api/files/delete', vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  })

  const _rename = useMutation({
    mutationFn: (vars: { oldPath: string; newPath: string }) => post('/api/files/rename', vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  })

  const _move = useMutation({
    mutationFn: (vars: { oldPath: string; newPath: string }) => post('/api/files/rename', vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  })

  const _copy = useMutation({
    mutationFn: (vars: { sourcePath: string; destinationDir: string }) =>
      post('/api/files/copy', vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  })

  const createFolderMutation = {
    ..._createFolder,
    mutate: (folderName: string, opts?: { onSuccess?: () => void }) => {
      const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName
      _createFolder.mutate({ type: 'folder' as const, path: folderPath }, opts)
    },
    mutateAsync: async (folderName: string) => {
      const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName
      return _createFolder.mutateAsync({ type: 'folder' as const, path: folderPath })
    },
  }

  const createFileMutation = {
    ..._createFile,
    mutate: (fileName: string, opts?: { onSuccess?: () => void }) => {
      const filePath = currentPath ? `${currentPath}/${fileName}` : fileName
      const defaultExt = inKb ? '.md' : '.txt'
      const finalFilePath = filePath.includes('.') ? filePath : `${filePath}${defaultExt}`
      _createFile.mutate({ type: 'file' as const, path: finalFilePath, content: '' }, opts)
    },
    mutateAsync: async (fileName: string) => {
      const filePath = currentPath ? `${currentPath}/${fileName}` : fileName
      const defaultExt = inKb ? '.md' : '.txt'
      const finalFilePath = filePath.includes('.') ? filePath : `${filePath}${defaultExt}`
      return _createFile.mutateAsync({ type: 'file' as const, path: finalFilePath, content: '' })
    },
  }

  const deleteFolderMutation = {
    ..._deleteFolder,
    mutate: (_unused?: unknown, opts?: { onSuccess?: () => void }) => {
      _deleteFolder.mutate({ path: currentPath }, opts)
    },
    mutateAsync: async () => {
      return _deleteFolder.mutateAsync({ path: currentPath })
    },
  }

  const deleteItemMutation = {
    ..._deleteItem,
    mutate: (itemPath: string, opts?: { onSuccess?: () => void }) => {
      _deleteItem.mutate({ path: itemPath }, opts)
    },
    mutateAsync: async (itemPath: string) => {
      return _deleteItem.mutateAsync({ path: itemPath })
    },
  }

  const renameMutation = {
    ..._rename,
    mutate: (
      { oldPath, newName }: { oldPath: string; newName: string },
      opts?: { onSuccess?: () => void },
    ) => {
      const pathParts = oldPath.split(/[/\\]/).filter(Boolean)
      const parentPath = pathParts.slice(0, -1).join('/')
      const newPath = parentPath ? `${parentPath}/${newName}` : newName
      _rename.mutate({ oldPath, newPath }, opts)
    },
    mutateAsync: async ({ oldPath, newName }: { oldPath: string; newName: string }) => {
      const pathParts = oldPath.split(/[/\\]/).filter(Boolean)
      const parentPath = pathParts.slice(0, -1).join('/')
      const newPath = parentPath ? `${parentPath}/${newName}` : newName
      return _rename.mutateAsync({ oldPath, newPath })
    },
  }

  const moveMutation = {
    ..._move,
    mutate: (
      { sourcePath, destinationDir }: { sourcePath: string; destinationDir: string },
      opts?: { onSuccess?: () => void },
    ) => {
      const fileName = sourcePath.split(/[/\\]/).pop()!
      const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
      _move.mutate({ oldPath: sourcePath, newPath }, opts)
    },
    mutateAsync: async ({
      sourcePath,
      destinationDir,
    }: {
      sourcePath: string
      destinationDir: string
    }) => {
      const fileName = sourcePath.split(/[/\\]/).pop()!
      const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
      return _move.mutateAsync({ oldPath: sourcePath, newPath })
    },
  }

  const copyMutation = _copy

  return {
    createFolderMutation,
    createFileMutation,
    deleteFolderMutation,
    deleteItemMutation,
    renameMutation,
    moveMutation,
    copyMutation,
  }
}
