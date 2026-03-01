import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'

export function useFileMutations(currentPath: string) {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()

  // Mutation for creating folders
  const createFolderMutation = useMutation({
    mutationFn: async (folderName: string) => {
      const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName
      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'folder', path: folderPath }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create folder')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    },
  })

  // Mutation for creating files
  const createFileMutation = useMutation({
    mutationFn: async (fileName: string) => {
      const filePath = currentPath ? `${currentPath}/${fileName}` : fileName
      const finalFilePath = filePath.includes('.') ? filePath : `${filePath}.txt`
      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file', path: finalFilePath, content: '' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create file')
      }
      return { data: await res.json(), filePath: finalFilePath }
    },
    onSuccess: ({ filePath }) => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      // Open the new file for editing
      const params = new URLSearchParams(searchParams)
      params.set('viewing', filePath)
      // Use replace to avoid adding file opens to browser history
      router.replace(`/?${params.toString()}`, { scroll: false })
    },
  })

  // Mutation for deleting current folder
  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete folder')
      }
      return res.json()
    },
    onSuccess: () => {
      // Navigate to parent folder
      const params = new URLSearchParams(searchParams)
      const pathParts = currentPath.split(/[/\\]/).filter(Boolean)
      if (pathParts.length > 1) {
        params.set('dir', pathParts.slice(0, -1).join('/'))
      } else {
        params.delete('dir')
      }
      router.push(`/?${params.toString()}`, { scroll: false })
    },
  })

  // Mutation for deleting individual files/folders
  const deleteItemMutation = useMutation({
    mutationFn: async (itemPath: string) => {
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    },
  })

  // Mutation for renaming files/folders
  const renameMutation = useMutation({
    mutationFn: async ({ oldPath, newName }: { oldPath: string; newName: string }) => {
      const pathParts = oldPath.split(/[/\\]/).filter(Boolean)
      const parentPath = pathParts.slice(0, -1).join('/')
      const newPath = parentPath ? `${parentPath}/${newName}` : newName

      const res = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to rename')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    },
  })

  const moveMutation = useMutation({
    mutationFn: async ({
      sourcePath,
      destinationDir,
    }: {
      sourcePath: string
      destinationDir: string
    }) => {
      const fileName = sourcePath.split(/[/\\]/).pop()!
      const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
      const res = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: sourcePath, newPath }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to move')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
    },
  })

  return {
    createFolderMutation,
    createFileMutation,
    deleteFolderMutation,
    deleteItemMutation,
    renameMutation,
    moveMutation,
  }
}
