'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AlertCircle } from 'lucide-react'
import { FileItem } from '@/lib/types'

interface CreateFolderDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  folderName: string
  onFolderNameChange: (name: string) => void
  onCreateFolder: () => void
  isPending: boolean
  error: Error | null
  folderExists: boolean
  onReset: () => void
}

export function CreateFolderDialog({
  isOpen,
  onOpenChange,
  folderName,
  onFolderNameChange,
  onCreateFolder,
  isPending,
  error,
  folderExists,
  onReset,
}: CreateFolderDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Folder</DialogTitle>
          <DialogDescription>Enter a name for the new folder.</DialogDescription>
        </DialogHeader>
        <Input
          value={folderName}
          onChange={(e) => onFolderNameChange(e.target.value)}
          placeholder='Folder name'
          onKeyDown={(e) => {
            if (e.key === 'Enter' && folderName.trim() && !folderExists) onCreateFolder()
          }}
          autoFocus
          disabled={isPending}
          className={folderExists ? 'border-yellow-500' : ''}
        />
        {folderExists && (
          <div className='rounded-lg bg-yellow-500/10 border border-yellow-500/50 p-3 flex items-start gap-2'>
            <AlertCircle className='h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0' />
            <div className='text-sm text-yellow-800 dark:text-yellow-200'>
              <p className='font-medium'>Folder already exists</p>
              <p className='text-xs mt-1 opacity-90'>
                A folder with this name already exists in this directory.
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
            {error.message}
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onReset} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={onCreateFolder}
            disabled={isPending || !folderName.trim() || folderExists}
          >
            {isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface CreateFileDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  fileName: string
  onFileNameChange: (name: string) => void
  onCreateFile: () => void
  isPending: boolean
  error: Error | null
  fileExists: boolean
  onReset: () => void
  /** Default extension when none provided (.md for knowledge base, .txt otherwise) */
  defaultExtension?: 'txt' | 'md'
}

export function CreateFileDialog({
  isOpen,
  onOpenChange,
  fileName,
  onFileNameChange,
  onCreateFile,
  isPending,
  error,
  fileExists,
  onReset,
  defaultExtension = 'txt',
}: CreateFileDialogProps) {
  const extExample = defaultExtension === 'md' ? 'notes.md' : 'notes.txt'
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New File</DialogTitle>
          <DialogDescription>
            Enter a name for the new file. .{defaultExtension} extension will be added if no
            extension is provided.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={fileName}
          onChange={(e) => onFileNameChange(e.target.value)}
          placeholder={`File name (e.g., ${extExample})`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && fileName.trim() && !fileExists) onCreateFile()
          }}
          autoFocus
          disabled={isPending}
          className={fileExists ? 'border-yellow-500' : ''}
        />
        {fileExists && (
          <div className='rounded-lg bg-yellow-500/10 border border-yellow-500/50 p-3 flex items-start gap-2'>
            <AlertCircle className='h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0' />
            <div className='text-sm text-yellow-800 dark:text-yellow-200'>
              <p className='font-medium'>File already exists</p>
              <p className='text-xs mt-1 opacity-90'>
                A file with this name already exists in this directory.
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
            {error.message}
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onReset} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onCreateFile} disabled={isPending || !fileName.trim() || fileExists}>
            {isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface RenameDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  itemName: string
  newName: string
  onNewNameChange: (name: string) => void
  onRename: () => void
  isPending: boolean
  error: Error | null
  nameExists: boolean
  isDirectory: boolean
  onReset: () => void
}

export function RenameDialog({
  isOpen,
  onOpenChange,
  itemName,
  newName,
  onNewNameChange,
  onRename,
  isPending,
  error,
  nameExists,
  isDirectory,
  onReset,
}: RenameDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {itemName}</DialogTitle>
          <DialogDescription>
            Enter a new name for this {isDirectory ? 'folder' : 'file'}.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          placeholder='New name'
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim() && newName !== itemName && !nameExists)
              onRename()
          }}
          autoFocus
          disabled={isPending}
          className={nameExists ? 'border-yellow-500' : ''}
        />
        {nameExists && (
          <div className='rounded-lg bg-yellow-500/10 border border-yellow-500/50 p-3 flex items-start gap-2'>
            <AlertCircle className='h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0' />
            <div className='text-sm text-yellow-800 dark:text-yellow-200'>
              <p className='font-medium'>Name already exists</p>
              <p className='text-xs mt-1 opacity-90'>
                A {isDirectory ? 'folder' : 'file'} with this name already exists in this directory.
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
            {error.message}
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onReset} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={onRename}
            disabled={isPending || !newName.trim() || newName === itemName || nameExists}
          >
            {isPending ? 'Renaming...' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface DeleteConfirmDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  item: FileItem | null
  currentFolderName?: string
  onDelete: () => void
  isPending: boolean
  error: Error | null
  onReset: () => void
  /** When true, show "Revoke Share" instead of "Delete" */
  isRevokeShare?: boolean
}

export function DeleteConfirmDialog({
  isOpen,
  onOpenChange,
  item,
  currentFolderName,
  onDelete,
  isPending,
  error,
  onReset,
  isRevokeShare = false,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isRevokeShare
              ? 'Revoke Share?'
              : item
                ? `Delete ${item.isDirectory ? 'Folder' : 'File'}?`
                : 'Delete Empty Folder?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRevokeShare && item ? (
              <>
                Are you sure you want to revoke the share link for &ldquo;{item.name}&rdquo;? The
                link will stop working immediately.
              </>
            ) : item ? (
              <>
                Are you sure you want to delete &ldquo;{item.name}&rdquo;?
                {item.isDirectory && (
                  <span className='block mt-1 text-sm'>(Only empty folders can be deleted)</span>
                )}
                <span className='block mt-2 text-sm font-medium'>
                  This action cannot be undone.
                </span>
              </>
            ) : (
              <>
                Are you sure you want to delete the folder &ldquo;{currentFolderName}&rdquo;? This
                action cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
            {error.message}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={onReset}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={isPending}
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
          >
            {isPending
              ? isRevokeShare
                ? 'Revoking...'
                : 'Deleting...'
              : isRevokeShare
                ? 'Revoke Share'
                : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
