import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { post } from '@/lib/api'
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
import { useShareLinkBase } from '@/lib/use-share-link-base'
import { queryKeys } from '@/lib/query-keys'

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
  /** When set, the dialog is rendered inside this element (e.g. workspace window). */
  container?: HTMLElement | null
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

function buildShareUrl(share: ShareLink, baseOrigin: string) {
  const url = `${baseOrigin}/share/${share.token}`
  return share.passcode ? `${url}?p=${encodeURIComponent(share.passcode)}` : url
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
  const shareLinkBase = useShareLinkBase()
  const [copiedLink, setCopiedLink] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editable, setEditable] = useState(() => share.editable)
  const [restrictions, setRestrictions] = useState<Required<ShareRestrictions>>(() =>
    extractRestrictions(share),
  )
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevShareRef = useRef(share)

  if (prevShareRef.current !== share) {
    prevShareRef.current = share
    setEditable(share.editable)
    setRestrictions(extractRestrictions(share))
  }

  const updateMutation = useMutation({
    mutationFn: (vars: {
      token: string
      editable: boolean
      restrictions: Required<ShareRestrictions>
    }) =>
      fetch('/api/shares', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
    },
  })

  const scheduleUpdate = useCallback(
    (newEditable: boolean, newRestrictions: Required<ShareRestrictions>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        updateMutation.mutate({
          token: share.token,
          editable: newEditable,
          restrictions: newRestrictions,
        })
      }, 500)
    },
    [updateMutation, share.token],
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
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const revokeMutation = useMutation({
    mutationFn: (vars: { token: string }) => post('/api/shares/delete', vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
      onRevoked()
    },
  })

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(share, shareLinkBase))
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const url = buildShareUrl(share, shareLinkBase)
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
        onClick={() => revokeMutation.mutate({ token: share.token })}
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
  container,
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
    mutationFn: (vars: {
      path: string
      isDirectory: boolean
      editable: boolean
      restrictions?: Required<ShareRestrictions>
    }) => post('/api/shares', vars),
    onSuccess: () => {
      setShowCreate(false)
      queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
    },
  })

  const hasShares = existingShares.length > 0

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      disablePointerDismissal={!!container}
    >
      <DialogContent
        className='sm:max-w-md max-h-[85vh] overflow-y-auto'
        container={container ?? undefined}
      >
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
                  onClick={() =>
                    createShareMutation.mutate({
                      path: filePath,
                      isDirectory,
                      editable: newEditable,
                      ...(newEditable ? { restrictions: newRestrictions } : {}),
                    })
                  }
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
