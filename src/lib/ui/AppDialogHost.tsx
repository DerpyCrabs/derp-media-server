import { Portal } from '@solidjs/web'
import { Show } from 'solid-js'
import { appDialogRequest, settleAppDialog } from './app-dialog'
import { useModalFocus } from './modal-focus'

export function AppDialogHost() {
  let dialogEl: HTMLDivElement | undefined

  const onKeyDown = useModalFocus({
    active: () => appDialogRequest() != null,
    element: () => dialogEl,
    onEscape: () => settleAppDialog(false),
  })

  return (
    <Show when={appDialogRequest()}>
      {(current) => (
        <Portal>
          <div
            class='fixed inset-0 z-[2000000] flex items-center justify-center bg-black/55 p-4'
            role='presentation'
            onKeyDown={onKeyDown}
            onPointerDown={(event) =>
              event.target === event.currentTarget && settleAppDialog(false)
            }
          >
            <div
              ref={(element) => {
                dialogEl = element
              }}
              role={current().kind === 'confirm' ? 'alertdialog' : 'dialog'}
              aria-modal='true'
              aria-labelledby='app-dialog-title'
              aria-describedby='app-dialog-description'
              class='w-full max-w-md rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl'
            >
              <h2 id='app-dialog-title' class='text-base font-semibold'>
                {current().title}
              </h2>
              <p
                id='app-dialog-description'
                class='mt-2 whitespace-pre-wrap text-sm text-muted-foreground'
              >
                {current().message}
              </p>
              <div class='mt-5 flex justify-end gap-2'>
                <Show when={current().kind === 'confirm'}>
                  <button
                    type='button'
                    class='h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent'
                    onClick={() => settleAppDialog(false)}
                  >
                    Cancel
                  </button>
                </Show>
                <button
                  type='button'
                  autofocus
                  class={
                    current().destructive
                      ? 'h-9 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90'
                      : 'h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90'
                  }
                  onClick={() => settleAppDialog(true)}
                >
                  {current().confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  )
}
