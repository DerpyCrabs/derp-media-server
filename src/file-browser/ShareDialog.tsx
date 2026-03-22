import { useMutation, useQueryClient } from '@tanstack/solid-query'
import { post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { ShareLink, ShareRestrictions } from '@/lib/shares'
import { formatFileSize } from '@/lib/media-utils'
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js'
import Check from 'lucide-solid/icons/check'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronUp from 'lucide-solid/icons/chevron-up'
import Copy from 'lucide-solid/icons/copy'
import LinkIcon from 'lucide-solid/icons/link'
import Plus from 'lucide-solid/icons/plus'
import Trash2 from 'lucide-solid/icons/trash-2'

const SIZE_PRESETS = [
  { label: '500 MB', value: 500 * 1024 * 1024 },
  { label: '1 GB', value: 1024 * 1024 * 1024 },
  { label: '2 GB', value: 2 * 1024 * 1024 * 1024 },
  { label: '5 GB', value: 5 * 1024 * 1024 * 1024 },
  { label: '10 GB', value: 10 * 1024 * 1024 * 1024 },
] as const

const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

type QuotaMode = 'unlimited' | 'preset' | 'custom'

type RequiredRestrictions = Required<ShareRestrictions>

function getQuotaMode(maxUploadBytes: number): QuotaMode {
  if (maxUploadBytes === 0) return 'unlimited'
  if (SIZE_PRESETS.some((p) => p.value === maxUploadBytes)) return 'preset'
  return 'custom'
}

function extractRestrictions(share: ShareLink): RequiredRestrictions {
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

function RestrictionsEditor(props: {
  restrictions: RequiredRestrictions
  onChange: (r: RequiredRestrictions) => void
}) {
  const quotaMode = () => getQuotaMode(props.restrictions.maxUploadBytes)

  function setMode(mode: QuotaMode) {
    if (mode === 'unlimited') props.onChange({ ...props.restrictions, maxUploadBytes: 0 })
    else if (mode === 'preset')
      props.onChange({ ...props.restrictions, maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES })
    else
      props.onChange({
        ...props.restrictions,
        maxUploadBytes: props.restrictions.maxUploadBytes || DEFAULT_MAX_UPLOAD_BYTES,
      })
  }

  return (
    <div class='space-y-3'>
      <label class='flex cursor-pointer items-center gap-3'>
        <input
          type='checkbox'
          checked={props.restrictions.allowUpload}
          class='border-input h-4 w-4 rounded'
          onChange={(e) =>
            props.onChange({ ...props.restrictions, allowUpload: e.currentTarget.checked })
          }
        />
        <div>
          <p class='text-sm font-medium'>Allow uploads & file creation</p>
          <p class='text-muted-foreground text-xs'>Create new files and folders</p>
        </div>
      </label>

      <label class='flex cursor-pointer items-center gap-3'>
        <input
          type='checkbox'
          checked={props.restrictions.allowEdit}
          class='border-input h-4 w-4 rounded'
          onChange={(e) =>
            props.onChange({ ...props.restrictions, allowEdit: e.currentTarget.checked })
          }
        />
        <div>
          <p class='text-sm font-medium'>Allow editing & renaming</p>
          <p class='text-muted-foreground text-xs'>Edit file contents, rename, and move items</p>
        </div>
      </label>

      <label class='flex cursor-pointer items-center gap-3'>
        <input
          type='checkbox'
          checked={props.restrictions.allowDelete}
          class='border-input h-4 w-4 rounded'
          onChange={(e) =>
            props.onChange({ ...props.restrictions, allowDelete: e.currentTarget.checked })
          }
        />
        <div>
          <p class='text-sm font-medium'>Allow deletion</p>
          <p class='text-muted-foreground text-xs'>Delete files and folders</p>
        </div>
      </label>

      <div class='space-y-2'>
        <p class='text-sm font-medium'>Upload size limit</p>
        <div class='flex gap-1.5'>
          <For each={['unlimited', 'preset', 'custom'] as const}>
            {(mode) => (
              <button
                type='button'
                class={`h-7 rounded-md border px-2 text-xs capitalize ${
                  quotaMode() === mode
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent'
                }`}
                onClick={() => setMode(mode)}
              >
                {mode}
              </button>
            )}
          </For>
        </div>
        <Show when={quotaMode() === 'preset'}>
          <div class='flex flex-wrap gap-1.5'>
            <For each={[...SIZE_PRESETS]}>
              {(preset) => (
                <button
                  type='button'
                  class={`h-7 rounded-md border px-2 text-xs ${
                    props.restrictions.maxUploadBytes === preset.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-accent'
                  }`}
                  onClick={() =>
                    props.onChange({ ...props.restrictions, maxUploadBytes: preset.value })
                  }
                >
                  {preset.label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={quotaMode() === 'custom'}>
          <div class='flex items-center gap-2'>
            <input
              type='number'
              min={1}
              class='border-input bg-background h-7 w-24 rounded-md border px-2 text-xs'
              value={Math.round(props.restrictions.maxUploadBytes / (1024 * 1024))}
              onInput={(e) => {
                const mb = parseInt(e.currentTarget.value, 10)
                if (!isNaN(mb) && mb > 0) {
                  props.onChange({ ...props.restrictions, maxUploadBytes: mb * 1024 * 1024 })
                }
              }}
            />
            <span class='text-muted-foreground text-xs'>MB</span>
          </div>
        </Show>
      </div>
    </div>
  )
}

function ShareLinkCard(props: {
  share: ShareLink
  shareLinkBase: string
  isDirectory: boolean
  isEditable: boolean
  onRevoked: () => void
}) {
  const queryClient = useQueryClient()
  const [copiedLink, setCopiedLink] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [editable, setEditable] = createSignal(untrack(() => props.share.editable))
  const [restrictions, setRestrictions] = createSignal<RequiredRestrictions>(
    untrack(() => extractRestrictions(props.share)),
  )

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  createEffect(() => {
    const s = props.share
    setEditable(s.editable)
    setRestrictions(extractRestrictions(s))
  })

  const updateMutation = useMutation(() => ({
    mutationFn: (vars: { token: string; editable: boolean; restrictions: RequiredRestrictions }) =>
      fetch('/api/shares', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }).then((r) => r.json()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
    },
  }))

  function scheduleUpdate(newEditable: boolean, newRestrictions: RequiredRestrictions) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      updateMutation.mutate({
        token: props.share.token,
        editable: newEditable,
        restrictions: newRestrictions,
      })
    }, 500)
  }

  const revokeMutation = useMutation(() => ({
    mutationFn: (vars: { token: string }) => post('/api/shares/delete', vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
      props.onRevoked()
    },
  }))

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(buildShareUrl(props.share, props.shareLinkBase))
      setCopiedLink(true)
      window.setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const url = () => buildShareUrl(props.share, props.shareLinkBase)
  const used = () => props.share.usedBytes || 0
  const limit = () => restrictions().maxUploadBytes

  const settingsSummary = createMemo(() => {
    const ed = editable()
    const r = restrictions()
    if (!ed) return 'Read-only'
    const denied: string[] = []
    if (!r.allowUpload) denied.push('upload')
    if (!r.allowEdit) denied.push('edit')
    if (!r.allowDelete) denied.push('delete')
    const rest = denied.length > 0 ? ` (no ${denied.join(', ')})` : ''
    const lim = limit()
    const quota =
      lim > 0
        ? ` · ${formatFileSize(used())} / ${formatFileSize(lim)}`
        : ` · ${formatFileSize(used())} (unlimited)`
    return `Editable${rest}${quota}`
  })

  return (
    <div class='space-y-3 rounded-lg border border-border p-3'>
      <div class='flex items-center justify-between'>
        <p class='text-muted-foreground text-xs'>
          Created{' '}
          {new Date(props.share.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
        <span class='bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs'>
          {props.share.isDirectory ? 'Folder' : 'File'}
        </span>
      </div>

      <div class='flex gap-2'>
        <input
          type='text'
          readOnly
          class='border-input bg-background flex-1 rounded-md border px-3 py-2 font-mono text-xs'
          value={url()}
        />
        <button
          type='button'
          title='Copy link'
          class='border-input bg-background inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border hover:bg-accent'
          onClick={() => void handleCopyLink()}
        >
          <Show when={copiedLink()} fallback={<Copy class='h-4 w-4' stroke-width={2} />}>
            <Check class='h-4 w-4' stroke-width={2} />
          </Show>
        </button>
      </div>

      <Show when={props.share.passcode}>
        <p class='text-muted-foreground text-xs'>Passcode is included in the link.</p>
      </Show>

      <button
        type='button'
        class='text-foreground flex h-8 w-full items-center justify-between rounded-md px-2 text-xs hover:bg-muted/50'
        onClick={() => setShowSettings(!showSettings())}
      >
        <span>{settingsSummary()}</span>
        <Show when={showSettings()} fallback={<ChevronDown class='h-3.5 w-3.5' stroke-width={2} />}>
          <ChevronUp class='h-3.5 w-3.5' stroke-width={2} />
        </Show>
      </button>

      <Show when={showSettings()}>
        <div class='space-y-3 pt-1'>
          <Show when={props.isDirectory && props.isEditable}>
            <label class='flex cursor-pointer items-center gap-3'>
              <input
                type='checkbox'
                checked={editable()}
                class='border-input h-4 w-4 rounded'
                onChange={(e) => {
                  const v = e.currentTarget.checked
                  setEditable(v)
                  scheduleUpdate(v, restrictions())
                }}
              />
              <div>
                <p class='text-sm font-medium'>Allow editing</p>
                <p class='text-muted-foreground text-xs'>
                  Recipients can create, edit, and delete files
                </p>
              </div>
            </label>
          </Show>

          <Show when={editable()}>
            <div class='space-y-3 rounded-lg border border-border p-3'>
              <p class='text-muted-foreground text-xs font-medium'>Restrictions</p>
              <RestrictionsEditor
                restrictions={restrictions()}
                onChange={(r) => {
                  setRestrictions(r)
                  scheduleUpdate(editable(), r)
                }}
              />
            </div>
          </Show>
        </div>
      </Show>

      <button
        type='button'
        class='bg-destructive text-destructive-foreground hover:bg-destructive/90 flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-sm font-medium disabled:opacity-50'
        disabled={revokeMutation.isPending}
        onClick={() => revokeMutation.mutate({ token: props.share.token })}
      >
        <Trash2 class='h-3.5 w-3.5' stroke-width={2} />
        {revokeMutation.isPending ? 'Revoking...' : 'Revoke'}
      </button>
    </div>
  )
}

export type ShareDialogProps = {
  isOpen: boolean
  onClose: () => void
  filePath: string
  fileName: string
  isDirectory: boolean
  isEditable: boolean
  existingShares: ShareLink[]
  shareLinkBase: string
}

export function ShareDialog(props: ShareDialogProps) {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = createSignal(false)
  const [newEditable, setNewEditable] = createSignal(false)
  const [newRestrictions, setNewRestrictions] = createSignal<RequiredRestrictions>({
    allowDelete: true,
    allowUpload: true,
    allowEdit: true,
    maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  })

  createEffect(() => {
    if (props.isOpen) {
      setShowCreate(false)
      setNewEditable(false)
      setNewRestrictions({
        allowDelete: true,
        allowUpload: true,
        allowEdit: true,
        maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
      })
    }
  })

  createEffect(() => {
    if (!props.isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    onCleanup(() => document.removeEventListener('keydown', onKeyDown))
  })

  const createShareMutation = useMutation(() => ({
    mutationFn: (vars: {
      path: string
      isDirectory: boolean
      editable: boolean
      restrictions?: RequiredRestrictions
    }) => post('/api/shares', vars),
    onSuccess: () => {
      setShowCreate(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
    },
  }))

  const hasShares = createMemo(() => props.existingShares.length > 0)

  const sortedExistingShares = createMemo(() =>
    [...props.existingShares].sort((a, b) => b.createdAt - a.createdAt),
  )

  function handleSubmitNewShare() {
    createShareMutation.mutate({
      path: props.filePath,
      isDirectory: props.isDirectory,
      editable: newEditable(),
      ...(newEditable() ? { restrictions: newRestrictions() } : {}),
    })
  }

  return (
    <Show when={props.isOpen}>
      <div
        class='fixed inset-0 z-550000 flex items-center justify-center bg-black/50 p-4'
        role='presentation'
        onClick={() => props.onClose()}
      >
        <div
          role='dialog'
          aria-modal='true'
          aria-labelledby='share-dialog-title'
          class='bg-card text-card-foreground max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-border p-6 shadow-lg'
          onClick={(e) => e.stopPropagation()}
        >
          <div class='mb-4 space-y-1.5'>
            <h2 id='share-dialog-title' class='flex items-center gap-2 text-lg font-semibold'>
              <LinkIcon class='h-5 w-5' stroke-width={2} />
              Share Links
            </h2>
            <p class='text-muted-foreground text-sm'>
              {hasShares()
                ? `${props.existingShares.length} share${props.existingShares.length > 1 ? 's' : ''} for "${props.fileName}"`
                : `Create a share link for "${props.fileName}"`}
            </p>
          </div>

          <div class='space-y-3'>
            <Show
              when={showCreate()}
              fallback={
                <button
                  type='button'
                  class='border-input bg-background hover:bg-accent flex h-9 w-full items-center justify-center gap-1.5 rounded-md border text-sm'
                  onClick={() => setShowCreate(true)}
                >
                  <Plus class='h-3.5 w-3.5' stroke-width={2} />
                  Create New Share Link
                </button>
              }
            >
              <div class='space-y-3 rounded-lg border border-dashed border-border p-3'>
                <p class='text-sm font-medium'>New Share Link</p>

                <Show when={props.isDirectory && props.isEditable}>
                  <>
                    <label class='flex cursor-pointer items-center gap-3'>
                      <input
                        type='checkbox'
                        checked={newEditable()}
                        class='border-input h-4 w-4 rounded'
                        onChange={(e) => setNewEditable(e.currentTarget.checked)}
                      />
                      <div>
                        <p class='text-sm font-medium'>Allow editing</p>
                        <p class='text-muted-foreground text-xs'>
                          Recipients can create, edit, and delete files
                        </p>
                      </div>
                    </label>

                    <Show when={newEditable()}>
                      <div class='space-y-3 rounded-lg border border-border p-3'>
                        <p class='text-muted-foreground text-xs font-medium'>Restrictions</p>
                        <RestrictionsEditor
                          restrictions={newRestrictions()}
                          onChange={setNewRestrictions}
                        />
                      </div>
                    </Show>
                  </>
                </Show>

                <div class='flex gap-2'>
                  <button
                    type='button'
                    class='bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium disabled:opacity-50'
                    disabled={createShareMutation.isPending}
                    onClick={() => handleSubmitNewShare()}
                  >
                    <LinkIcon class='h-3.5 w-3.5' stroke-width={2} />
                    {createShareMutation.isPending ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    type='button'
                    class='border-input bg-background hover:bg-accent h-9 rounded-md border px-3 text-sm'
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Show>

            <For each={sortedExistingShares()}>
              {(share) => (
                <ShareLinkCard
                  share={share}
                  shareLinkBase={props.shareLinkBase}
                  isDirectory={props.isDirectory}
                  isEditable={props.isEditable}
                  onRevoked={() => {}}
                />
              )}
            </For>

            <Show when={!hasShares() && !showCreate()}>
              <p class='text-muted-foreground py-2 text-center text-sm'>
                No share links yet. Create one to get started.
              </p>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
