import CircleAlert from 'lucide-solid/icons/circle-alert'
import { Show } from 'solid-js'
import { useWorkspaceSession } from './WorkspaceSession'

export function WorkspaceSaveStatus() {
  const session = useWorkspaceSession()
  return (
    <Show when={session.saveError()} keyed>
      {(failure) => (
        <div
          role='alert'
          title={`Workspace save failed: ${failure.message}`}
          class='flex h-7 max-w-72 shrink-0 items-center gap-1.5 border border-destructive/50 bg-destructive/10 px-2 text-xs text-destructive'
          data-testid='workspace-save-error'
        >
          <CircleAlert class='size-3.5 shrink-0' />
          <span class='truncate'>{failure.message}</span>
          <Show when={failure.retryable}>
            <button
              type='button'
              class='shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50'
              disabled={session.saving()}
              onClick={() => void session.retrySave()}
            >
              Retry
            </button>
          </Show>
          <Show when={failure.takeover}>
            <button
              type='button'
              class='shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50'
              disabled={session.saving()}
              onClick={() => void session.takeControl()}
            >
              Take control
            </button>
          </Show>
        </div>
      )}
    </Show>
  )
}
