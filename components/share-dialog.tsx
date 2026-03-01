'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
import { Copy, Check, Link, Trash2, ChevronDown, ChevronUp, Plus } from 'lucide-react'
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
  existingShares: ShareLink[]
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

function extractRestrictions(share: ShareLink): Required<ShareRestrictions> {
  const r = share.restrictions || {}
  return {
    allowDelete: r.allowDelete !== false,
    allowUpload: r.allowUpload !== false,
    allowEdit: r.allowEdit !== false,
    maxUploadBytes: r.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
  }
}

function buildShareUrl(share: ShareLink) {
  const base = `${window.location.origin}/share/${share.token}`
  return share.passcode ? `${base}?p=${encodeURIComponent(share.passcode)}` : base
}

function ShareCard({
  share,
  isDirectory,
  isEditable,
  onRevoked,
}: {
  share: ShareLink
  isDirectory: boolean
  isEditable: boolean
  onRevoked: () => void
}) {
  const queryClient = useQueryClient()
  const [copiedLink, setCopiedLink] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editable, setEditable] = useState(share.editable)
  const [restrictions, setRestrictions] = useState<Required<ShareRestrictions>>(
    extractRestrictions(share),
  )
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    setEditable(share.editable)
    setRestrictions(extractRestrictions(share))
  }, [share])

  const updateMutation = useMutation({
    mutationFn: async (payload: { editable?: boolean; restrictions?: ShareRestrictions }) => {
      const res = await fetch('/api/shares', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: share.token, ...payload }),
      })
      if (!res.ok) throw new Error('Failed to update share')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] })
    },
  })

  const scheduleUpdate = useCallback(
    (newEditable: boolean, newRestrictions: Required<ShareRestrictions>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        updateMutation.mutate({
          editable: newEditable,
          restrictions: newRestrictions,
        })
      }, 500)
    },
    [updateMutation],
  )

  const handleEditableChange = (val: boolean) => {
    setEditable(val)
    scheduleUpdate(val, restrictions)
  }

  const handleRestrictionsChange = (r: Required<ShareRestrictions>) => {
    setRestrictions(r)
    scheduleUpdate(editable, r)
  }

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      return
    }
  }, [editable, restrictions])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const revokeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/shares', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: share.token }),
      })
      if (!res.ok) throw new Error('Failed to revoke share')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] })
      onRevoked()
    },
  })

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(share))
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const url = buildShareUrl(share)
  const used = share.usedBytes || 0
  const limit = restrictions.maxUploadBytes

  return (
    <div className='rounded-lg border p-3 space-y-3'>
      {/* Header: date + type */}
      <div className='flex items-center justify-between'>
        <p className='text-xs text-muted-foreground'>
          Created{' '}
          {new Date(share.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
        <span className='text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground'>
          {share.isDirectory ? 'Folder' : 'File'}
        </span>
      </div>

      {/* URL + copy */}
      <div className='flex gap-2'>
        <Input value={url} readOnly className='font-mono text-xs' />
        <Button variant='outline' size='icon' onClick={handleCopyLink} title='Copy link'>
          {copiedLink ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
        </Button>
      </div>

      {share.passcode && (
        <p className='text-xs text-muted-foreground'>Passcode is included in the link.</p>
      )}

      {/* Settings toggle */}
      <Button
        variant='ghost'
        size='sm'
        className='w-full justify-between h-8'
        onClick={() => setShowSettings(!showSettings)}
      >
        <span className='text-xs'>
          {editable ? 'Editable' : 'Read-only'}
          {editable &&
            (() => {
              const denied: string[] = []
              if (!restrictions.allowUpload) denied.push('upload')
              if (!restrictions.allowEdit) denied.push('edit')
              if (!restrictions.allowDelete) denied.push('delete')
              if (denied.length > 0) return ` (no ${denied.join(', ')})`
              return ''
            })()}
          {editable && limit > 0 ? ` · ${formatFileSize(used)} / ${formatFileSize(limit)}` : ''}
          {editable && limit === 0 ? ` · ${formatFileSize(used)} (unlimited)` : ''}
        </span>
        {showSettings ? (
          <ChevronUp className='h-3.5 w-3.5' />
        ) : (
          <ChevronDown className='h-3.5 w-3.5' />
        )}
      </Button>

      {showSettings && (
        <div className='space-y-3 pt-1'>
          {/* Editable toggle */}
          {isDirectory && isEditable && (
            <label className='flex items-center gap-3 cursor-pointer'>
              <input
                type='checkbox'
                checked={editable}
                onChange={(e) => handleEditableChange(e.target.checked)}
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

          {/* Restrictions */}
          {editable && (
            <div className='rounded-lg border p-3 space-y-3'>
              <p className='text-xs font-medium text-muted-foreground'>Restrictions</p>
              <RestrictionsEditor restrictions={restrictions} onChange={handleRestrictionsChange} />
            </div>
          )}
        </div>
      )}

      {/* Revoke */}
      <Button
        variant='destructive'
        size='sm'
        className='w-full'
        onClick={() => revokeMutation.mutate()}
        disabled={revokeMutation.isPending}
      >
        <Trash2 className='h-3.5 w-3.5 mr-1.5' />
        {revokeMutation.isPending ? 'Revoking...' : 'Revoke'}
      </Button>
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
  existingShares,
}: ShareDialogProps) {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newEditable, setNewEditable] = useState(false)
  const [newRestrictions, setNewRestrictions] = useState<Required<ShareRestrictions>>({
    allowDelete: true,
    allowUpload: true,
    allowEdit: true,
    maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  })

  useEffect(() => {
    if (isOpen) {
      setShowCreate(false)
      setNewEditable(false)
      setNewRestrictions({
        allowDelete: true,
        allowUpload: true,
        allowEdit: true,
        maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
      })
    }
  }, [isOpen])

  const createShareMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          isDirectory,
          editable: newEditable,
          ...(newEditable ? { restrictions: newRestrictions } : {}),
        }),
      })
      if (!res.ok) throw new Error('Failed to create share')
      return res.json()
    },
    onSuccess: () => {
      setShowCreate(false)
      queryClient.invalidateQueries({ queryKey: ['shares'] })
    },
  })

  const hasShares = existingShares.length > 0

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Link className='h-5 w-5' />
            Share Links
          </DialogTitle>
          <DialogDescription>
            {hasShares
              ? `${existingShares.length} share${existingShares.length > 1 ? 's' : ''} for "${fileName}"`
              : `Create a share link for "${fileName}"`}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          {/* Create new share */}
          {showCreate ? (
            <div className='rounded-lg border border-dashed p-3 space-y-3'>
              <p className='text-sm font-medium'>New Share Link</p>

              {isDirectory && isEditable && (
                <>
                  <label className='flex items-center gap-3 cursor-pointer'>
                    <input
                      type='checkbox'
                      checked={newEditable}
                      onChange={(e) => setNewEditable(e.target.checked)}
                      className='h-4 w-4 rounded border-input'
                    />
                    <div>
                      <p className='text-sm font-medium'>Allow editing</p>
                      <p className='text-xs text-muted-foreground'>
                        Recipients can create, edit, and delete files
                      </p>
                    </div>
                  </label>

                  {newEditable && (
                    <div className='rounded-lg border p-3 space-y-3'>
                      <p className='text-xs font-medium text-muted-foreground'>Restrictions</p>
                      <RestrictionsEditor
                        restrictions={newRestrictions}
                        onChange={setNewRestrictions}
                      />
                    </div>
                  )}
                </>
              )}

              <div className='flex gap-2'>
                <Button
                  className='flex-1'
                  size='sm'
                  onClick={() => createShareMutation.mutate()}
                  disabled={createShareMutation.isPending}
                >
                  <Link className='h-3.5 w-3.5 mr-1.5' />
                  {createShareMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
                <Button variant='outline' size='sm' onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant='outline'
              className='w-full'
              size='sm'
              onClick={() => setShowCreate(true)}
            >
              <Plus className='h-3.5 w-3.5 mr-1.5' />
              Create New Share Link
            </Button>
          )}

          {/* Existing shares list (newest first) */}
          {[...existingShares]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((share) => (
              <ShareCard
                key={share.token}
                share={share}
                isDirectory={isDirectory}
                isEditable={isEditable}
                onRevoked={() => {}}
              />
            ))}

          {!hasShares && !showCreate && (
            <p className='text-sm text-muted-foreground text-center py-2'>
              No share links yet. Create one to get started.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
