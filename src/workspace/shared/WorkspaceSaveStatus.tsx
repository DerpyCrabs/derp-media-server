import CircleAlert from '@effectweb/lucide/icons/circle-alert'
import { observe, view } from 'effectweb'
import type { WorkspaceSession } from './WorkspaceSession'
export const WorkspaceSaveStatus = view<{ session: WorkspaceSession }>((props) =>
  observe(props.session.source, (state) => {
    const failure = state.saveError
    if (!failure) return null
    return (
      <div
        role='alert'
        title={`Workspace save failed: ${failure.message}`}
        class='flex h-7 max-w-72 shrink-0 items-center gap-1.5 border border-destructive/50 bg-destructive/10 px-2 text-xs text-destructive'
        data-testid='workspace-save-error'
      >
        <CircleAlert class='size-3.5 shrink-0' />
        <span class='truncate'>{failure.message}</span>
        {failure.retryable ? (
          <button
            type='button'
            class='shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50'
            disabled={state.saving}
            onClick={() => props.session.document.retrySave()}
          >
            Retry
          </button>
        ) : null}
        {failure.takeover ? (
          <button
            type='button'
            class='shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50'
            disabled={state.saving}
            onClick={() => props.session.lifecycle.takeControl()}
          >
            Take control
          </button>
        ) : null}
      </div>
    )
  }),
)
