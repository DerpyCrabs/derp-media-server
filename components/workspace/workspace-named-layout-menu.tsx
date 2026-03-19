import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, RotateCcw, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { post } from '@/lib/api'
import { navigate, usePathname, useSearchParams } from '@/lib/router'
import { queryKeys } from '@/lib/query-keys'
import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import {
  makeWorkspaceLayoutPresetId,
  type WorkspaceLayoutPreset,
  type WorkspaceLayoutScope,
} from '@/lib/workspace-layout-presets'

interface WorkspaceNamedLayoutMenuProps {
  scope: WorkspaceLayoutScope
  /** Admin: null; share: token for POST /api/share/:token/workspaceLayoutPresets */
  shareToken: string | null
  presets: WorkspaceLayoutPreset[]
  presetsReady: boolean
  collectLayoutSnapshot: () => PersistedWorkspaceState
  applyLayoutSnapshot: (
    snapshot: PersistedWorkspaceState,
    options?: { baselinePresetId?: string | null },
  ) => void
  syncLayoutBaselineToCurrent: () => void
  revertLayoutToBaseline: () => void
  declareBaselinePresetId: (id: string | null) => void
  isLayoutDirty: boolean
  layoutBaselinePresetId: string | null
}

export function WorkspaceNamedLayoutMenu({
  scope,
  shareToken,
  presets,
  presetsReady,
  collectLayoutSnapshot,
  applyLayoutSnapshot,
  syncLayoutBaselineToCurrent,
  revertLayoutToBaseline,
  declareBaselinePresetId,
  isLayoutDirty,
  layoutBaselinePresetId,
}: WorkspaceNamedLayoutMenuProps) {
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const urlSearch = useSearchParams()
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

  const persistPresetsMutation = useMutation({
    mutationFn: async (next: WorkspaceLayoutPreset[]) => {
      if (shareToken) {
        return post<{ workspaceLayoutPresets: WorkspaceLayoutPreset[] }>(
          `/api/share/${shareToken}/workspaceLayoutPresets`,
          { presets: next },
        )
      }
      return post<{ workspaceLayoutPresets: WorkspaceLayoutPreset[] }>(
        '/api/settings/workspaceLayoutPresets',
        { presets: next },
      )
    },
    onSettled: () => {
      if (shareToken) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(shareToken) })
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      }
    },
  })

  const persistPresets = useCallback(
    (next: WorkspaceLayoutPreset[]) => {
      void persistPresetsMutation.mutateAsync(next)
    },
    [persistPresetsMutation],
  )

  const setPresetInUrl = useCallback(
    (presetId: string | null) => {
      const p = new URLSearchParams(urlSearch.toString())
      if (presetId) {
        p.set('preset', presetId)
      } else {
        p.delete('preset')
      }
      const qs = p.toString()
      navigate(`${pathname}${qs ? `?${qs}` : ''}`, { replace: true })
    },
    [pathname, urlSearch],
  )

  const handleRestore = useCallback(
    (id: string) => {
      const found = presets.find((x) => x.id === id)
      if (!found) return
      applyLayoutSnapshot(found.snapshot, { baselinePresetId: found.id })
      setPresetInUrl(found.id)
    },
    [presets, applyLayoutSnapshot, setPresetInUrl],
  )

  const handleSave = useCallback(() => {
    const name = saveName.trim()
    if (!name || !presetsReady) return
    const now = new Date().toISOString()
    const snapshot = collectLayoutSnapshot()
    const id = makeWorkspaceLayoutPresetId()
    const next: WorkspaceLayoutPreset = {
      id,
      name,
      scope,
      snapshot,
      createdAt: now,
      updatedAt: now,
    }
    persistPresets([...presets, next])
    syncLayoutBaselineToCurrent()
    declareBaselinePresetId(id)
    setPresetInUrl(id)
    setSaveName('')
    setSaveOpen(false)
  }, [
    saveName,
    presetsReady,
    scope,
    presets,
    collectLayoutSnapshot,
    persistPresets,
    syncLayoutBaselineToCurrent,
    declareBaselinePresetId,
    setPresetInUrl,
  ])

  const handleUpdateSaved = useCallback(() => {
    if (!layoutBaselinePresetId || !presetsReady) return
    const found = presets.find((x) => x.id === layoutBaselinePresetId)
    if (!found) return
    const snapshot = collectLayoutSnapshot()
    const now = new Date().toISOString()
    persistPresets(
      presets.map((p) =>
        p.id === layoutBaselinePresetId ? { ...p, snapshot, updatedAt: now } : p,
      ),
    )
    syncLayoutBaselineToCurrent()
  }, [
    layoutBaselinePresetId,
    presetsReady,
    presets,
    collectLayoutSnapshot,
    persistPresets,
    syncLayoutBaselineToCurrent,
  ])

  const handleDelete = useCallback(
    (id: string) => {
      if (!presetsReady) return
      persistPresets(presets.filter((p) => p.id !== id))
      if (layoutBaselinePresetId === id) {
        declareBaselinePresetId(null)
        setPresetInUrl(null)
      }
    },
    [
      presetsReady,
      presets,
      persistPresets,
      layoutBaselinePresetId,
      setPresetInUrl,
      declareBaselinePresetId,
    ],
  )

  return (
    <>
      <DropdownMenu modal>
        <DropdownMenuTrigger
          type='button'
          title='Layouts — save or restore'
          disabled={!presetsReady}
          className='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40'
        >
          <LayoutGrid className='h-4 w-4' strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' side='top' sideOffset={6}>
          <DropdownMenuItem disabled={!presetsReady} onClick={() => setSaveOpen(true)}>
            Save current layout…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Restore</DropdownMenuLabel>
            {!presetsReady ? (
              <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
            ) : presets.length === 0 ? (
              <DropdownMenuItem disabled>No saved layouts</DropdownMenuItem>
            ) : (
              presets.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  className='flex min-h-8 items-center gap-0.5 pr-1'
                  onClick={() => handleRestore(p.id)}
                >
                  <span className='min-w-0 flex-1 truncate'>{p.name}</span>
                  <button
                    type='button'
                    className='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring'
                    aria-label={`Remove layout “${p.name}”`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleDelete(p.id)
                    }}
                  >
                    <Trash2 className='size-3.5' strokeWidth={2} />
                  </button>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuGroup>
          {isLayoutDirty ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => revertLayoutToBaseline()}>
                <RotateCcw className='size-4' />
                Revert to baseline
              </DropdownMenuItem>
              {layoutBaselinePresetId ? (
                <DropdownMenuItem disabled={!presetsReady} onClick={handleUpdateSaved}>
                  Update saved layout
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className='gap-4 sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>Save layout</DialogTitle>
            <DialogDescription>Choose a name for this window arrangement.</DialogDescription>
          </DialogHeader>
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder='e.g. Review + browser'
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && saveName.trim()) handleSave()
            }}
          />
          <DialogFooter className='gap-2 sm:justify-end'>
            <Button type='button' variant='outline' onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button type='button' onClick={handleSave} disabled={!saveName.trim() || !presetsReady}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
