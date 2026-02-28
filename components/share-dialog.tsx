'use client'

import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Copy, Check, Link, Trash2 } from 'lucide-react'
import type { ShareLink } from '@/lib/shares'

interface ShareDialogProps {
  isOpen: boolean
  onClose: () => void
  filePath: string
  fileName: string
  isDirectory: boolean
  isEditable: boolean
  existingShare: ShareLink | null
}

export function ShareDialog({
  isOpen,
  onClose,
  filePath,
  fileName,
  isDirectory,
  isEditable,
  existingShare,
}: ShareDialogProps) {
  const queryClient = useQueryClient()
  const [editable, setEditable] = useState(false)
  const [shareData, setShareData] = useState<{ share: ShareLink; url: string } | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)

  const buildShareUrl = (share: ShareLink) => {
    const base = `${window.location.origin}/share/${share.token}`
    return share.passcode ? `${base}?p=${encodeURIComponent(share.passcode)}` : base
  }

  useEffect(() => {
    if (existingShare) {
      setShareData({
        share: existingShare,
        url: buildShareUrl(existingShare),
      })
      setEditable(existingShare.editable)
    } else {
      setShareData(null)
      setEditable(false)
    }
  }, [existingShare, isOpen])

  const createShareMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, isDirectory, editable }),
      })
      if (!res.ok) throw new Error('Failed to create share')
      return res.json()
    },
    onSuccess: (data: { share: ShareLink; url: string }) => {
      setShareData({
        share: data.share,
        url: buildShareUrl(data.share),
      })
      queryClient.invalidateQueries({ queryKey: ['shares'] })
    },
  })

  const revokeShareMutation = useMutation({
    mutationFn: async (token: string) => {
      const res = await fetch('/api/shares', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) throw new Error('Failed to revoke share')
    },
    onSuccess: () => {
      setShareData(null)
      queryClient.invalidateQueries({ queryKey: ['shares'] })
    },
  })

  const handleCopyLink = async () => {
    if (!shareData) return
    try {
      await navigator.clipboard.writeText(shareData.url)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const handleCreate = () => {
    createShareMutation.mutate()
  }

  const handleRevoke = () => {
    if (shareData) {
      revokeShareMutation.mutate(shareData.share.token)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Link className='h-5 w-5' />
            {shareData ? 'Share Link' : 'Create Share Link'}
          </DialogTitle>
          <DialogDescription>
            {shareData ? `Sharing "${fileName}"` : `Create a share link for "${fileName}"`}
          </DialogDescription>
        </DialogHeader>

        {shareData ? (
          <div className='space-y-4'>
            {/* Share URL */}
            <div className='space-y-2'>
              <label className='text-sm font-medium'>Link</label>
              <div className='flex gap-2'>
                <Input value={shareData.url} readOnly className='font-mono text-xs' />
                <Button variant='outline' size='icon' onClick={handleCopyLink} title='Copy link'>
                  {copiedLink ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
                </Button>
              </div>
            </div>

            {shareData.share.passcode && (
              <p className='text-xs text-muted-foreground'>Passcode is included in the link.</p>
            )}

            {/* Share info */}
            <div className='rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground space-y-1'>
              <p>Type: {shareData.share.isDirectory ? 'Folder' : 'File'}</p>
              {shareData.share.editable && <p>Access: Editable</p>}
              <p>Created: {new Date(shareData.share.createdAt).toLocaleDateString()}</p>
            </div>

            {/* Revoke */}
            <Button
              variant='destructive'
              className='w-full'
              onClick={handleRevoke}
              disabled={revokeShareMutation.isPending}
            >
              <Trash2 className='h-4 w-4 mr-2' />
              {revokeShareMutation.isPending ? 'Revoking...' : 'Revoke Share'}
            </Button>
          </div>
        ) : (
          <div className='space-y-4'>
            {/* Editable toggle (only for directories in editable folders) */}
            {isDirectory && isEditable && (
              <label className='flex items-center gap-3 cursor-pointer'>
                <input
                  type='checkbox'
                  checked={editable}
                  onChange={(e) => setEditable(e.target.checked)}
                  className='h-4 w-4 rounded border-input'
                />
                <div>
                  <p className='text-sm font-medium'>Allow editing</p>
                  <p className='text-xs text-muted-foreground'>
                    Recipients can create, edit, and delete files
                  </p>
                </div>
              </label>
            )}

            <Button
              className='w-full'
              onClick={handleCreate}
              disabled={createShareMutation.isPending}
            >
              <Link className='h-4 w-4 mr-2' />
              {createShareMutation.isPending ? 'Creating...' : 'Create Share Link'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
