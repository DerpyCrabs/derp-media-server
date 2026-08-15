import { type Accessor, createEffect } from 'solid-js'

export function useInlineModeInputFocus(
  inlineMode: Accessor<'file' | 'folder' | null>,
  fileInput: () => HTMLInputElement | undefined,
  folderInput: () => HTMLInputElement | undefined,
) {
  createEffect(
    () => inlineMode(),
    (mode) => {
      if (mode === 'file') {
        queueMicrotask(() => fileInput()?.focus())
      } else if (mode === 'folder') {
        queueMicrotask(() => folderInput()?.focus())
      }
    },
  )
}
