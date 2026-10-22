import type { FileItem } from '@/lib/files/types'
export type FileRowMenuState = { x: number; y: number; file: FileItem }
export function fileRowContextMenu(
  menu: FileRowMenuState | null,
  setMenu: (menu: FileRowMenuState | null) => void,
  onDeleteRequest: (file: FileItem) => void,
) {
  const dismiss = () => setMenu(null)
  return {
    menu,
    dismiss,
    openRowContextMenu: (event: MouseEvent, file: FileItem) => {
      event.preventDefault()
      event.stopPropagation()
      setMenu({ x: event.clientX, y: event.clientY, file })
    },
    openRowMenuFromButton: (event: MouseEvent, file: FileItem) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      setMenu({ x: rect.right, y: rect.bottom, file })
    },
    confirmDelete: (file: FileItem) => {
      onDeleteRequest(file)
      dismiss()
    },
  }
}
