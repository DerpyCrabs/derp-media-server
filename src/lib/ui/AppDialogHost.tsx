import { Button } from '@/lib/ui/button'
import { Dialog } from '@/lib/ui/dialog'
import { controllerView, modelOwner, observe, view, list, type ControllerHost } from 'effectweb'
import { acquireWindowDialogs } from './app-dialog'
import { viewWindow } from '@/lib/browser/view-window'
export const AppDialogHost = controllerView(
  {
    controller: (_props: object, host: ControllerHost) => {
      const lease = acquireWindowDialogs(viewWindow(host))
      const owner = modelOwner({ dialogs: lease.dialogs })
      return {
        source: owner.source,
        lifetime: {
          dispose: () => {
            owner.dispose()
            lease.dispose()
          },
        },
      }
    },
  },
  view((model) =>
    observe(model.dialogs.source, ({ request }) =>
      request ? (
        <Dialog
          open
          role={request.kind === 'confirm' ? 'alertdialog' : 'dialog'}
          title={request.title}
          showCloseButton={false}
          onOpenChange={(open) => {
            if (!open) model.dialogs.settle(false)
          }}
          class='sm:max-w-md'
          footer={
            <>
              {request.kind !== 'alert' ? (
                <Button variant='outline' autofocus onClick={() => model.dialogs.settle(false)}>
                  Cancel
                </Button>
              ) : null}
              {request.kind !== 'choose' ? (
                <Button
                  variant={request.destructive ? 'destructive' : 'default'}
                  onClick={() => model.dialogs.settle(true)}
                >
                  {request.confirmLabel}
                </Button>
              ) : null}
            </>
          }
        >
          <p class='whitespace-pre-wrap break-all text-sm text-muted-foreground'>
            {request.message}
          </p>
          {request.kind === 'choose' ? (
            <div
              class='mt-4 flex max-h-72 flex-col gap-1 overflow-auto'
              role='group'
              aria-label='Applications'
            >
              {list(
                request.choices ?? [],
                (choice) => choice.id,
                (choice) => (
                  <Button
                    variant='outline'
                    class='h-auto min-h-10 justify-start whitespace-normal text-left'
                    data-dialog-choice={choice.id}
                    onClick={() => model.dialogs.settle(choice.id)}
                  >
                    {choice.label}
                  </Button>
                ),
              )}
            </div>
          ) : null}
        </Dialog>
      ) : null,
    ),
  ),
)
