import { createSignal } from 'solid-js'

type DialogState =
  | { kind: 'none' }
  | { kind: 'image'; src: string }
  | { kind: 'edit'; id: string; originalText: string; value: string }
  | { kind: 'rename'; value: string }
  | { kind: 'takeover' }

export function createHermesChatUiState() {
  const [dialog, setDialog] = createSignal<DialogState>({ kind: 'none' })
  const [atTranscriptBottom, setAtTranscriptBottom] = createSignal(true)
  const [history, setHistory] = createSignal({ items: [] as string[], index: -1 })
  const [find, setFind] = createSignal({ open: false, query: '', index: 0 })

  const dialogs = {
    previewImage: () => {
      const state = dialog()
      return state.kind === 'image' ? state.src : null
    },
    openImage: (src: string) => setDialog({ kind: 'image', src }),
    editTarget: () => {
      const state = dialog()
      return state.kind === 'edit' ? { id: state.id, text: state.originalText } : null
    },
    openEdit: (target: { id: string; text: string }) =>
      setDialog({ kind: 'edit', id: target.id, originalText: target.text, value: target.text }),
    editValue: () => {
      const state = dialog()
      return state.kind === 'edit' ? state.value : ''
    },
    updateEdit: (value: string) =>
      setDialog((state) => (state.kind === 'edit' ? { ...state, value } : state)),
    renameOpen: () => dialog().kind === 'rename',
    openRename: (value: string) => setDialog({ kind: 'rename', value }),
    renameValue: () => {
      const state = dialog()
      return state.kind === 'rename' ? state.value : ''
    },
    updateRename: (value: string) =>
      setDialog((state) =>
        state.kind === 'rename' ? { ...state, value } : { kind: 'rename', value },
      ),
    takeoverOpen: () => dialog().kind === 'takeover',
    openTakeover: () => setDialog({ kind: 'takeover' }),
    close: (kind: Exclude<DialogState['kind'], 'none'>) =>
      setDialog((state) => (state.kind === kind ? { kind: 'none' } : state)),
  }

  const promptHistory = {
    record: (prompt: string) =>
      setHistory((state) => ({
        items: [...state.items.filter((item) => item !== prompt), prompt].slice(-100),
        index: state.index,
      })),
    resetCursor: () => setHistory((state) => ({ ...state, index: -1 })),
    navigate: (direction: 'older' | 'newer') => {
      const state = history()
      if (!state.items.length) return undefined
      const index =
        direction === 'older'
          ? Math.min(state.items.length - 1, state.index + 1)
          : Math.max(-1, state.index - 1)
      setHistory({ ...state, index })
      return index < 0 ? '' : (state.items[state.items.length - 1 - index] ?? '')
    },
  }

  const search = {
    open: () => find().open,
    show: () => setFind((state) => ({ ...state, open: true })),
    hide: () => setFind((state) => ({ ...state, open: false })),
    query: () => find().query,
    changeQuery: (query: string) => setFind((state) => ({ ...state, query, index: 0 })),
    index: () => find().index,
    setIndex: (index: number) => setFind((state) => ({ ...state, index })),
  }

  return {
    dialogs,
    promptHistory,
    search,
    transcript: { atBottom: atTranscriptBottom, markAtBottom: setAtTranscriptBottom },
  }
}
