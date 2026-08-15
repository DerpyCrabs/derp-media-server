import { type Accessor, createEffect } from 'solid-js'

export function useInlineModeInputFocus(
  inlineMode: Accessor<'file' | 'folder' | null>,
  fileInput: () => HTMLInputElement | undefined,
  folderInput: () => HTMLInputElement | undefined,
) {
  createEffect(() => {
    const m = inlineMode()
    if (m === 'file') {
      queueMicrotask(() => fileInput()?.focus())
    } else if (m === 'folder') {
      queueMicrotask(() => folderInput()?.focus())
    }
  })
}
