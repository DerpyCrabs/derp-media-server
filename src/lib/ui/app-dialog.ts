import { createSignal, untrack } from 'solid-js'

export type AppDialogRequest = {
  kind: 'alert' | 'confirm'
  title: string
  message: string
  confirmLabel: string
  destructive: boolean
  resolve: (confirmed: boolean) => void
}

export const [appDialogRequest, setAppDialogRequest] = createSignal<AppDialogRequest | null>(null)
const queue: AppDialogRequest[] = []

function showNext() {
  setAppDialogRequest(queue.shift() ?? null)
}

function enqueue(request: Omit<AppDialogRequest, 'resolve'>) {
  return new Promise<boolean>((resolve) => {
    queue.push({ ...request, resolve })
    if (!untrack(appDialogRequest)) showNext()
  })
}

export function settleAppDialog(confirmed: boolean) {
  const current = appDialogRequest()
  if (!current) return
  showNext()
  current.resolve(confirmed)
}

export function showAppAlert(message: string, title = 'Error') {
  return enqueue({ kind: 'alert', title, message, confirmLabel: 'OK', destructive: false }).then(
    () => undefined,
  )
}

export function showAppConfirm(options: {
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
}) {
  return enqueue({
    kind: 'confirm',
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel ?? 'Confirm',
    destructive: options.destructive ?? false,
  })
}
