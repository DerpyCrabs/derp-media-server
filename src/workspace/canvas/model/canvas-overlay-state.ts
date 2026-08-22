import { createSignal } from 'solid-js'

export type CanvasContextMenuState = {
  kind: 'canvas'
  clientX: number
  clientY: number
  worldX: number
  worldY: number
}

export type CanvasDialogState = {
  kind: 'new-note'
  point: { x: number; y: number }
  initialContent: string
  title: string
  directory: string
}

type PinMenuState = { x: number; y: number; pinId: string }
type MenuState =
  | { kind: 'canvas'; value: CanvasContextMenuState }
  | { kind: 'pin'; value: PinMenuState }
  | null

export function createCanvasOverlayState() {
  const [activeMenu, setActiveMenu] = createSignal<MenuState>(null)
  const [dialog, setDialog] = createSignal<CanvasDialogState | null>(null)

  return {
    canvasMenu: {
      value: () => {
        const state = activeMenu()
        return state?.kind === 'canvas' ? state.value : null
      },
      open: (value: CanvasContextMenuState) => setActiveMenu({ kind: 'canvas', value }),
      close: () => setActiveMenu((state) => (state?.kind === 'canvas' ? null : state)),
    },
    pinMenu: {
      value: () => {
        const state = activeMenu()
        return state?.kind === 'pin' ? state.value : null
      },
      open: (value: PinMenuState) => setActiveMenu({ kind: 'pin', value }),
      close: () => setActiveMenu((state) => (state?.kind === 'pin' ? null : state)),
    },
    note: {
      value: dialog,
      open: (value: CanvasDialogState) => setDialog(value),
      close: () => setDialog(null),
      updateTitle: (title: string) => setDialog((state) => (state ? { ...state, title } : state)),
      updateDirectory: (directory: string) =>
        setDialog((state) => (state ? { ...state, directory } : state)),
    },
  }
}
