export type ModalOverlayScope = 'viewport' | 'window'

const backdropBase = 'inset-0 flex items-center justify-center bg-black/50 p-4'

/** Standard file-browser modals: viewport = fixed; workspace pane = absolute to containing window. */
export function modalDialogBackdropClass(scope: ModalOverlayScope = 'viewport'): string {
  const pos = scope === 'window' ? 'absolute' : 'fixed'
  return `${pos} ${backdropBase} z-60`
}
