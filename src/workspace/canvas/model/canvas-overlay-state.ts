import { modelOwner } from 'effectweb'

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
  const owner = modelOwner<{ activeMenu: MenuState; dialog: CanvasDialogState | null }>({
    activeMenu: null,
    dialog: null,
  })
  const activeMenu = () => owner.read().activeMenu
  const dialog = () => owner.read().dialog

  return {
    source: owner.source,
    dispose: owner.dispose,
    canvasMenu: {
      value: () => {
        const state = activeMenu()
        return state?.kind === 'canvas' ? state.value : null
      },
      open: (value: CanvasContextMenuState) =>
        owner.patch({ activeMenu: { kind: 'canvas', value } }),
      close: () => owner.edit('activeMenu', (state) => (state?.kind === 'canvas' ? null : state)),
    },
    pinMenu: {
      value: () => {
        const state = activeMenu()
        return state?.kind === 'pin' ? state.value : null
      },
      open: (value: PinMenuState) => owner.patch({ activeMenu: { kind: 'pin', value } }),
      close: () => owner.edit('activeMenu', (state) => (state?.kind === 'pin' ? null : state)),
    },
    note: {
      value: dialog,
      open: (value: CanvasDialogState) => owner.patch({ dialog: value }),
      close: () => owner.patch({ dialog: null }),
      updateTitle: (title: string) =>
        owner.edit('dialog', (state) => (state ? { ...state, title } : state)),
      updateDirectory: (directory: string) =>
        owner.edit('dialog', (state) => (state ? { ...state, directory } : state)),
    },
  }
}
