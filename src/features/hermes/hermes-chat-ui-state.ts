import { modelOwner } from 'effectweb'

type DialogState =
  | { kind: 'none' }
  | { kind: 'image'; src: string }
  | { kind: 'edit'; id: string; originalText: string; value: string }
  | { kind: 'rename'; value: string }
  | { kind: 'takeover' }

type UiModel = {
  dialog: DialogState
  atTranscriptBottom: boolean
  history: { items: string[]; index: number }
  find: { open: boolean; query: string; index: number }
}
export function createHermesChatUiState() {
  const owner = modelOwner<UiModel>({
    dialog: { kind: 'none' },
    atTranscriptBottom: true,
    history: { items: [], index: -1 },
    find: { open: false, query: '', index: 0 },
  })
  const dialog = () => owner.read().dialog
  const history = () => owner.read().history
  const find = () => owner.read().find
  const atTranscriptBottom = () => owner.read().atTranscriptBottom
  const setDialog = (update: DialogState | ((state: DialogState) => DialogState)) =>
    owner.patch({ dialog: typeof update === 'function' ? update(dialog()) : update })
  const setHistory = (
    update: UiModel['history'] | ((state: UiModel['history']) => UiModel['history']),
  ) => owner.patch({ history: typeof update === 'function' ? update(history()) : update })
  const setFind = (update: UiModel['find'] | ((state: UiModel['find']) => UiModel['find'])) =>
    owner.patch({ find: typeof update === 'function' ? update(find()) : update })
  const setAtTranscriptBottom = (value: boolean) => {
    if (owner.read().atTranscriptBottom !== value) owner.patch({ atTranscriptBottom: value })
  }
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

  const commands = {
    dialogs,
    promptHistory,
    search,
    transcript: { atBottom: atTranscriptBottom, markAtBottom: setAtTranscriptBottom },
  }
  return {
    ...commands,
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    snapshot: (model: UiModel) => ({
      ...commands,
      dialogs: {
        ...dialogs,
        previewImage: () => (model.dialog.kind === 'image' ? model.dialog.src : null),
        editTarget: () =>
          model.dialog.kind === 'edit'
            ? { id: model.dialog.id, text: model.dialog.originalText }
            : null,
        editValue: () => (model.dialog.kind === 'edit' ? model.dialog.value : ''),
        renameOpen: () => model.dialog.kind === 'rename',
        renameValue: () => (model.dialog.kind === 'rename' ? model.dialog.value : ''),
        takeoverOpen: () => model.dialog.kind === 'takeover',
      },
      search: {
        ...search,
        open: () => model.find.open,
        query: () => model.find.query,
        index: () => model.find.index,
      },
      transcript: { ...commands.transcript, atBottom: () => model.atTranscriptBottom },
    }),
  }
}
