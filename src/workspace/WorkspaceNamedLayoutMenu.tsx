import { post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import {
  makeWorkspaceLayoutPresetId,
  type WorkspaceLayoutPreset,
  type WorkspaceLayoutScope,
} from '@/lib/workspace-layout-presets'
import { useMutation, useQueryClient } from '@tanstack/solid-query'
import LayoutGrid from 'lucide-solid/icons/layout-grid'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Trash2 from 'lucide-solid/icons/trash-2'
import { For, Show, createSignal } from 'solid-js'
import { navigateSearchParams } from '../browser-history'

function snapshotForLayoutPreset(s: PersistedWorkspaceState): PersistedWorkspaceState {
  return {
    ...s,
    browserTabTitle: undefined,
    browserTabIcon: undefined,
    browserTabIconColor: undefined,
  }
}

type Props = {
  scope: WorkspaceLayoutScope
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

export function WorkspaceNamedLayoutMenu(props: Props) {
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [saveOpen, setSaveOpen] = createSignal(false)
  const [saveName, setSaveName] = createSignal('')
  const [menuPos, setMenuPos] = createSignal<{ left: number; top: number }>({ left: 0, top: 0 })

  const persistPresetsMutation = useMutation(() => ({
    mutationFn: async (next: WorkspaceLayoutPreset[]) => {
      if (props.shareToken) {
        return post<{ workspaceLayoutPresets: WorkspaceLayoutPreset[] }>(
          `/api/share/${props.shareToken}/workspaceLayoutPresets`,
          { presets: next },
        )
      }
      return post<{ workspaceLayoutPresets: WorkspaceLayoutPreset[] }>(
        '/api/settings/workspaceLayoutPresets',
        { presets: next },
      )
    },
    onSettled: () => {
      if (props.shareToken) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(props.shareToken) })
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      }
    },
  }))

  function persistPresets(next: WorkspaceLayoutPreset[]) {
    void persistPresetsMutation.mutateAsync(next)
  }

  function clearPresetQueryParam() {
    navigateSearchParams({ preset: null }, 'replace')
  }

  function handleRestore(id: string) {
    const found = props.presets.find((x) => x.id === id)
    if (!found) return
    props.applyLayoutSnapshot(found.snapshot, { baselinePresetId: found.id })
    clearPresetQueryParam()
    setMenuOpen(false)
  }

  async function handleSave() {
    const name = saveName().trim()
    if (!name || !props.presetsReady) return
    const now = new Date().toISOString()
    const snapshot = snapshotForLayoutPreset(props.collectLayoutSnapshot())
    const id = makeWorkspaceLayoutPresetId()
    const next: WorkspaceLayoutPreset = {
      id,
      name,
      scope: props.scope,
      snapshot,
      createdAt: now,
      updatedAt: now,
    }
    await persistPresetsMutation.mutateAsync([...props.presets, next])
    if (props.shareToken) {
      await queryClient.refetchQueries({ queryKey: queryKeys.shareInfo(props.shareToken) })
    } else {
      await queryClient.refetchQueries({ queryKey: queryKeys.settings() })
    }
    props.syncLayoutBaselineToCurrent()
    props.declareBaselinePresetId(id)
    clearPresetQueryParam()
    setSaveName('')
    setSaveOpen(false)
  }

  function handleUpdateSaved() {
    const baselineId = props.layoutBaselinePresetId
    if (!baselineId || !props.presetsReady) return
    const found = props.presets.find((x) => x.id === baselineId)
    if (!found) return
    const snapshot = snapshotForLayoutPreset(props.collectLayoutSnapshot())
    const now = new Date().toISOString()
    persistPresets(
      props.presets.map((p) => (p.id === baselineId ? { ...p, snapshot, updatedAt: now } : p)),
    )
    props.syncLayoutBaselineToCurrent()
    setMenuOpen(false)
  }

  function handleDelete(id: string) {
    if (!props.presetsReady) return
    persistPresets(props.presets.filter((p) => p.id !== id))
    if (props.layoutBaselinePresetId === id) {
      props.declareBaselinePresetId(null)
      clearPresetQueryParam()
    }
  }

  function openMenu(anchor: DOMRect) {
    const w = 220
    const left = Math.min(anchor.left, window.innerWidth - w - 8)
    const top = anchor.top - 8
    setMenuPos({ left, top })
    setMenuOpen(true)
  }

  return (
    <>
      <button
        type='button'
        data-testid='workspace-named-layout-trigger'
        title='Layouts — save or restore'
        disabled={!props.presetsReady}
        class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40'
        onClick={(e) => {
          const el = e.currentTarget
          openMenu(el.getBoundingClientRect())
        }}
      >
        <LayoutGrid class='h-4 w-4' stroke-width={2} />
      </button>

      <Show when={menuOpen()}>
        <div
          class='fixed inset-0 z-[999998]'
          role='presentation'
          onPointerDown={() => setMenuOpen(false)}
        />
        <div
          data-workspace-layout-menu
          class='fixed z-[999999] min-w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
          style={{
            left: `${menuPos().left}px`,
            top: `${menuPos().top}px`,
            transform: 'translateY(-100%)',
          }}
          role='menu'
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type='button'
            role='menuitem'
            class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40'
            disabled={!props.presetsReady}
            onClick={() => {
              setMenuOpen(false)
              setSaveOpen(true)
            }}
          >
            Save current layout…
          </button>
          <div class='my-1 h-px bg-border' role='separator' />
          <div class='px-2 py-1.5 text-xs font-medium text-muted-foreground'>Restore</div>
          <Show when={!props.presetsReady}>
            <div class='px-2 py-1.5 text-sm text-muted-foreground'>Loading…</div>
          </Show>
          <Show when={props.presetsReady && props.presets.length === 0}>
            <div class='px-2 py-1.5 text-sm text-muted-foreground'>No saved layouts</div>
          </Show>
          <For each={props.presets}>
            {(p) => (
              <div class='flex min-h-8 items-center gap-0.5 rounded-sm pr-1 hover:bg-accent/50'>
                <button
                  type='button'
                  role='menuitem'
                  class='min-w-0 flex-1 cursor-pointer truncate rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground'
                  onClick={() => handleRestore(p.id)}
                >
                  {p.name}
                </button>
                <button
                  type='button'
                  class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring'
                  aria-label={`Remove layout “${p.name}”`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleDelete(p.id)
                  }}
                >
                  <Trash2 class='size-3.5' stroke-width={2} />
                </button>
              </div>
            )}
          </For>
          <Show when={props.isLayoutDirty}>
            <div class='my-1 h-px bg-border' role='separator' />
            <button
              type='button'
              role='menuitem'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'
              onClick={() => {
                props.revertLayoutToBaseline()
                setMenuOpen(false)
              }}
            >
              <RotateCcw class='size-4' stroke-width={2} />
              Revert to baseline
            </button>
            <Show when={props.layoutBaselinePresetId}>
              <button
                type='button'
                role='menuitem'
                class='flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40'
                disabled={!props.presetsReady}
                onClick={() => handleUpdateSaved()}
              >
                Update saved layout
              </button>
            </Show>
          </Show>
        </div>
      </Show>

      <Show when={saveOpen()}>
        <div
          class='fixed inset-0 z-[1000000] flex items-center justify-center bg-black/50 p-4'
          role='presentation'
          onClick={() => setSaveOpen(false)}
        >
          <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='workspace-save-layout-title'
            class='w-full max-w-sm gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg'
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id='workspace-save-layout-title' class='text-lg font-semibold'>
              Save layout
            </h2>
            <p class='text-muted-foreground mt-1 text-sm'>
              Choose a name for this window arrangement.
            </p>
            <input
              class='mt-4 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm'
              placeholder='e.g. Review + browser'
              value={saveName()}
              onInput={(e) => setSaveName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveName().trim()) void handleSave()
              }}
            />
            <div class='mt-6 flex justify-end gap-2'>
              <button
                type='button'
                class='h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent'
                onClick={() => setSaveOpen(false)}
              >
                Cancel
              </button>
              <button
                type='button'
                class='h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
                disabled={!saveName().trim() || !props.presetsReady}
                onClick={() => void handleSave()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
