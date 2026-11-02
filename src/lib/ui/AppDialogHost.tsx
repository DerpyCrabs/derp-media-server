import { Button } from '@/lib/ui/button'
import { Dialog } from '@/lib/ui/dialog'
import { controllerView, modelOwner, observe, view, type ControllerHost } from 'effectweb'
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
              {request.kind === 'confirm' ? (
                <Button variant='outline' autofocus onClick={() => model.dialogs.settle(false)}>
                  Cancel
                </Button>
              ) : null}
              <Button
                variant={request.destructive ? 'destructive' : 'default'}
                onClick={() => model.dialogs.settle(true)}
              >
                {request.confirmLabel}
              </Button>
            </>
          }
        >
          <p class='whitespace-pre-wrap text-sm text-muted-foreground'>{request.message}</p>
        </Dialog>
      ) : null,
    ),
  ),
)
