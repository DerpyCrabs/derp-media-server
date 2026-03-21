import {
  useWorkspaceFileOpenTargetStore,
  type WorkspaceFileOpenTarget,
} from '@/lib/workspace-file-open-target'
import Check from 'lucide-solid/icons/check'
import Settings from 'lucide-solid/icons/settings'
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { cn } from '@/lib/utils'

const FILE_OPEN_TARGETS: {
  value: WorkspaceFileOpenTarget
  label: string
  hint: string
}[] = [
  {
    value: 'new-tab',
    label: 'New tab',
    hint: 'Open in the same window group as the file browser (tab strip).',
  },
  {
    value: 'new-window',
    label: 'New window',
    hint: 'Open as a separate floating workspace window.',
  },
]

const triggerClass =
  'h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400 cursor-pointer outline-none border-0 bg-transparent'

export function WorkspaceTaskbarSettings() {
  const [open, setOpen] = createSignal(false)
  const [targetTick, setTargetTick] = createSignal(0)

  onMount(() => {
    const unsub = useWorkspaceFileOpenTargetStore.subscribe(() => setTargetTick((n) => n + 1))
    onCleanup(unsub)
  })

  const fileOpenTarget = () => {
    void targetTick()
    return useWorkspaceFileOpenTargetStore.getState().target
  }

  function setFileTarget(value: WorkspaceFileOpenTarget) {
    useWorkspaceFileOpenTargetStore.getState().setTarget(value)
  }

  return (
    <div class='relative shrink-0'>
      <button
        type='button'
        class={triggerClass}
        title='Settings'
        aria-label='Open settings'
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <Settings class='h-4 w-4' stroke-width={2} aria-hidden='true' />
      </button>
      <Show when={open()}>
        <div
          class='fixed inset-0 z-[100000] bg-black/40'
          role='presentation'
          onClick={() => setOpen(false)}
        />
        <div
          role='dialog'
          aria-modal='true'
          aria-labelledby='workspace-settings-title'
          class='ring-foreground/10 fixed left-1/2 top-1/2 z-[100001] max-h-[85vh] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-lg ring-1'
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id='workspace-settings-title' class='text-lg font-semibold'>
            Settings
          </h2>
          <div class='mt-6 grid gap-6'>
            <div>
              <div class='mb-2 text-xs font-medium text-muted-foreground'>
                Workspace · open files
              </div>
              <p class='mb-3 text-xs text-muted-foreground'>
                Default when you open a file from the workspace browser (saved on this device).
              </p>
              <div class='flex flex-col gap-2'>
                <For each={FILE_OPEN_TARGETS}>
                  {(opt) => {
                    const selected = () => fileOpenTarget() === opt.value
                    return (
                      <button
                        type='button'
                        title={opt.hint}
                        class={cn(
                          'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                          selected()
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/50 hover:bg-muted',
                        )}
                        onClick={() => {
                          setFileTarget(opt.value)
                          setOpen(false)
                        }}
                      >
                        <span class='flex-1'>{opt.label}</span>
                        <Show when={selected()}>
                          <Check class='h-4 w-4 shrink-0' stroke-width={2} aria-hidden='true' />
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
