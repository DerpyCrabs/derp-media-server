import type { FileItem } from '@/lib/types'
import type { Accessor } from 'solid-js'
import { createSignal } from 'solid-js'

type MenuState = { x: number; y: number; file: FileItem }

type UseFileRowContextMenuOptions = {
  isEditable: Accessor<boolean>
  onDeleteRequest: (file: FileItem) => void
}

export function useFileRowContextMenu(options: UseFileRowContextMenuOptions) {
  const [menu, setMenu] = createSignal<MenuState | null>(null)

  const dismiss = () => setMenu(null)

  function openRowContextMenu(e: MouseEvent, file: FileItem) {
    if (!options.isEditable()) return
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, file })
  }

  function confirmDelete(file: FileItem) {
    options.onDeleteRequest(file)
    dismiss()
  }

  return {
    menu,
    openRowContextMenu,
    dismiss,
    confirmDelete,
  }
}
