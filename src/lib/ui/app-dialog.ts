import { Effect } from 'effect'
import { modelOwner } from 'effectweb'

export type AppDialogRequest = {
  readonly kind: 'alert' | 'confirm'
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly destructive: boolean
}
export type AppConfirmOptions = {
  readonly title: string
  readonly message: string
  readonly confirmLabel?: string
  readonly destructive?: boolean
}

export function createAppDialogs() {
  const owner = modelOwner({ request: null as AppDialogRequest | null })
  type Pending = { request: AppDialogRequest; settle: (confirmed: boolean) => void }
  const pending: Pending[] = []
  const publish = () => owner.patch({ request: pending[0]?.request ?? null })
  const enqueue = (request: AppDialogRequest) =>
    Effect.callback<boolean>((resume) => {
      if (owner.disposed) return resume(Effect.succeed(false))
      const entry: Pending = { request, settle: (value) => resume(Effect.succeed(value)) }
      pending.push(entry)
      publish()
      return Effect.sync(() => {
        const index = pending.indexOf(entry)
        if (index !== -1) {
          pending.splice(index, 1)
          publish()
        }
      })
    })
  const dispose = () => {
    const waiting = pending.splice(0)
    publish()
    owner.dispose()
    for (const entry of waiting) entry.settle(false)
  }
  return {
    source: owner.source,
    read: () => owner.read().request,
    settle: (confirmed: boolean) => {
      const current = pending.shift()
      if (!current) return
      publish()
      current.settle(confirmed)
    },
    alert: (message: string, title = 'Error') =>
      enqueue({ kind: 'alert', title, message, confirmLabel: 'OK', destructive: false }).pipe(
        Effect.asVoid,
      ),
    confirm: (options: AppConfirmOptions) =>
      enqueue({
        kind: 'confirm',
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? 'Confirm',
        destructive: options.destructive ?? false,
      }),
    dispose,
  }
}

export const appDialogs = createAppDialogs()
export const appDialogSource = appDialogs.source
export const appDialogRequest = appDialogs.read
export const settleAppDialog = appDialogs.settle
export const showAppAlertEffect = appDialogs.alert
export const showAppConfirmEffect = appDialogs.confirm
