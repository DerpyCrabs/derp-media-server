'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { Copy, Check, Link, Trash2, Save, ChevronDown, ChevronUp } from 'lucide-react'
import type { ShareLink, ShareRestrictions } from '@/lib/shares'
import { formatFileSize } from '@/lib/media-utils'

const SIZE_PRESETS = [
  { label: '500 MB', value: 500 * 1024 * 1024 },
  { label: '1 GB', value: 1024 * 1024 * 1024 },
  { label: '2 GB', value: 2 * 1024 * 1024 * 1024 },
  { label: '5 GB', value: 5 * 1024 * 1024 * 1024 },
  { label: '10 GB', value: 10 * 1024 * 1024 * 1024 },
]

const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

interface ShareDialogProps {
  isOpen: boolean
  onClose: () => void
  filePath: string
  fileName: string
  isDirectory: boolean
  isEditable: boolean
  existingShare: ShareLink | null
}

type QuotaMode = 'unlimited' | 'preset' | 'custom'

function getQuotaMode(maxUploadBytes: number): QuotaMode {
  if (maxUploadBytes === 0) return 'unlimited'
  if (SIZE_PRESETS.some((p) => p.value === maxUploadBytes)) return 'preset'
  return 'custom'
}

function RestrictionsEditor({
  restrictions,
  onChange,
}: {
  restrictions: Required<ShareRestrictions>
  onChange: (r: Required<ShareRestrictions>) => void
}) {
  const quotaMode = getQuotaMode(restrictions.maxUploadBytes)

  const setMode = (mode: QuotaMode) => {
    if (mode === 'unlimited') onChange({ ...restrictions, maxUploadBytes: 0 })
    else if (mode === 'preset')
      onChange({ ...restrictions, maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES })
    else
      onChange({
        ...restrictions,
        maxUploadBytes: restrictions.maxUploadBytes || DEFAULT_MAX_UPLOAD_BYTES,
      })
  }

  return (
    <div className='space-y-3'>
      <label className='flex items-center gap-3 cursor-pointer'>
        <input
          type='checkbox'
          checked={restrictions.allowUpload}
          onChange={(e) => onChange({ ...restrictions, allowUpload: e.target.checked })}
          className='h-4 w-4 rounded border-input'
        />
        <div>
          <p className='text-sm font-medium'>Allow uploads & file creation</p>
          <p className='text-xs text-muted-foreground'>Create new files and folders</p>
        </div>
      </label>

      <label className='flex items-center gap-3 cursor-pointer'>
        <input
          type='checkbox'
          checked={restrictions.allowEdit}
          onChange={(e) => onChange({ ...restrictions, allowEdit: e.target.checked })}
          className='h-4 w-4 rounded border-input'
        />
        <div>
          <p className='text-sm font-medium'>Allow editing & renaming</p>
          <p className='text-xs text-muted-foreground'>
            Edit file contents, rename, and move items
          </p>
        </div>
      </label>

      <label className='flex items-center gap-3 cursor-pointer'>
        <input
          type='checkbox'
          checked={restrictions.allowDelete}
          onChange={(e) => onChange({ ...restrictions, allowDelete: e.target.checked })}
          className='h-4 w-4 rounded border-input'
        />
        <div>
          <p className='text-sm font-medium'>Allow deletion</p>
          <p className='text-xs text-muted-foreground'>Delete files and folders</p>
        </div>
      </label>

      <div className='space-y-2'>
        <p className='text-sm font-medium'>Upload size limit</p>
        <div className='flex gap-1.5'>
          {(['unlimited', 'preset', 'custom'] as const).map((mode) => (
            <Button
              key={mode}
              type='button'
              variant={quotaMode === mode ? 'default' : 'outline'}
              size='sm'
              className='h-7 text-xs capitalize'
              onClick={() => setMode(mode)}
            >
              {mode}
            </Button>
          ))}
        </div>
        {quotaMode === 'preset' && (
          <div className='flex flex-wrap gap-1.5'>
            {SIZE_PRESETS.map((preset) => (
              <Button
                key={preset.value}
                type='button'
                variant={restrictions.maxUploadBytes === preset.value ? 'default' : 'outline'}
                size='sm'
                className='h-7 text-xs'
                onClick={() => onChange({ ...restrictions, maxUploadBytes: preset.value })}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        )}
        {quotaMode === 'custom' && (
          <div className='flex items-center gap-2'>
            <Input
              type='number'
              min={1}
              value={Math.round(restrictions.maxUploadBytes / (1024 * 1024))}
              onChange={(e) => {
                const mb = parseInt(e.target.value, 10)
                if (!isNaN(mb) && mb > 0) {
                  onChange({ ...restrictions, maxUploadBytes: mb * 1024 * 1024 })
                }
              }}
              className='h-7 text-xs w-24'
            />
            <span className='text-xs text-muted-foreground'>MB</span>
          </div>
        )}
      </div>
    </div>
  )
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
  const [showRestrictions, setShowRestrictions] = useState(false)
  const [restrictions, setRestrictions] = useState<Required<ShareRestrictions>>({
    allowDelete: true,
    allowUpload: true,
    allowEdit: true,
    maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  })

  const buildShareUrl = (share: ShareLink) => {
    const base = `${window.location.origin}/share/${share.token}`
    return share.passcode ? `${base}?p=${encodeURIComponent(share.passcode)}` : base
  }

  const loadRestrictions = useCallback((share: ShareLink) => {
    const r = share.restrictions || {}
    setRestrictions({
      allowDelete: r.allowDelete !== false,
      allowUpload: r.allowUpload !== false,
      allowEdit: r.allowEdit !== false,
      maxUploadBytes: r.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
    })
  }, [])

  useEffect(() => {
    if (existingShare) {
      setShareData({
        share: existingShare,
        url: buildShareUrl(existingShare),
      })
      setEditable(existingShare.editable)
      loadRestrictions(existingShare)
      setShowRestrictions(false)
    } else {
      setShareData(null)
      setEditable(false)
      setRestrictions({
        allowDelete: true,
        allowUpload: true,
        allowEdit: true,
        maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
      })
      setShowRestrictions(false)
    }
  }, [existingShare, isOpen, loadRestrictions])

  const createShareMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          isDirectory,
          editable,
          ...(editable ? { restrictions } : {}),
        }),
      })
      if (!res.ok) throw new Error('Failed to create share')
      return res.json()
    },
    onSuccess: (data: { share: ShareLink; url: string }) => {
      setShareData({
        share: data.share,
        url: buildShareUrl(data.share),
      })
      loadRestrictions(data.share)
      queryClient.invalidateQueries({ queryKey: ['shares'] })
    },
  })

  const updateRestrictionsMutation = useMutation({
    mutationFn: async () => {
      if (!shareData) throw new Error('No share')
      const res = await fetch('/api/shares', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: shareData.share.token,
          restrictions,
        }),
      })
      if (!res.ok) throw new Error('Failed to update restrictions')
      return res.json()
    },
    onSuccess: (data: { share: ShareLink }) => {
      if (shareData) {
        setShareData({ ...shareData, share: data.share })
      }
      loadRestrictions(data.share)
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

  const restrictionsSummary = (share: ShareLink) => {
    const r = share.restrictions || {}
    const denied: string[] = []
    if (r.allowDelete === false) denied.push('delete')
    if (r.allowUpload === false) denied.push('upload')
    if (r.allowEdit === false) denied.push('edit')
    const limit = r.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES
    const used = share.usedBytes || 0
    return { denied, limit, used }
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
              {shareData.share.editable && (
                <>
                  <p>Access: Editable</p>
                  {(() => {
                    const { denied, limit, used } = restrictionsSummary(shareData.share)
                    return (
                      <>
                        {denied.length > 0 && <p>Restricted: {denied.join(', ')}</p>}
                        <p>
                          Quota:{' '}
                          {limit === 0
                            ? `${formatFileSize(used)} used (unlimited)`
                            : `${formatFileSize(used)} / ${formatFileSize(limit)} used`}
                        </p>
                      </>
                    )
                  })()}
                </>
              )}
              <p>Created: {new Date(shareData.share.createdAt).toLocaleDateString()}</p>
            </div>

            {/* Restrictions editor for editable shares */}
            {shareData.share.editable && (
              <div>
                <Button
                  variant='ghost'
                  size='sm'
                  className='w-full justify-between'
                  onClick={() => setShowRestrictions(!showRestrictions)}
                >
                  <span>Edit Restrictions</span>
                  {showRestrictions ? (
                    <ChevronUp className='h-4 w-4' />
                  ) : (
                    <ChevronDown className='h-4 w-4' />
                  )}
                </Button>
                {showRestrictions && (
                  <div className='mt-2 space-y-3 rounded-lg border p-3'>
                    <RestrictionsEditor restrictions={restrictions} onChange={setRestrictions} />
                    <Button
                      className='w-full'
                      size='sm'
                      onClick={() => updateRestrictionsMutation.mutate()}
                      disabled={updateRestrictionsMutation.isPending}
                    >
                      <Save className='h-4 w-4 mr-2' />
                      {updateRestrictionsMutation.isPending ? 'Saving...' : 'Save Restrictions'}
                    </Button>
                  </div>
                )}
              </div>
            )}

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
              <>
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

                {editable && (
                  <div className='rounded-lg border p-3 space-y-3'>
                    <p className='text-sm font-medium text-muted-foreground'>Restrictions</p>
                    <RestrictionsEditor restrictions={restrictions} onChange={setRestrictions} />
                  </div>
                )}
              </>
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
