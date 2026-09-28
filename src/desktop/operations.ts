export function runDesktopOperation(operation: Promise<unknown>) {
  window.dispatchEvent(new CustomEvent('desktop-operation', { detail: { pending: true } }))
  void operation.then(
    () =>
      window.dispatchEvent(new CustomEvent('desktop-operation', { detail: { pending: false } })),
    (error: unknown) =>
      window.dispatchEvent(
        new CustomEvent('desktop-operation', {
          detail: { pending: false, error: error instanceof Error ? error.message : String(error) },
        }),
      ),
  )
}
