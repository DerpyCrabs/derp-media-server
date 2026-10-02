import { describe, expect, test } from 'bun:test'
import {
  windowContentEquals,
  type ApplicationWindowContentProps,
} from '@/workspace/shared/window-content-model'

const noop = () => {}
function content(): ApplicationWindowContentProps {
  return {
    windowId: 'browser',
    definition: {
      id: 'browser',
      type: 'browser',
      title: 'Files',
      source: { kind: 'local' },
      initialState: { dir: '/books' },
    },
    visible: true,
    active: true,
    editableFolders: ['/books'],
    knowledgeBases: [],
    fileIconContext: {
      customIcons: {},
      knowledgeBases: [],
      playingPath: null,
      currentFile: null,
      mediaPlayerIsPlaying: false,
      mediaType: null,
    },
    actions: {
      browser: {
        navigate: noop,
        openViewer: noop,
        openReader: noop,
        openVirtual: noop,
        play: noop,
      },
      viewer: { updateViewing: noop },
      hermes: { sessionCreated: noop, titleChanged: noop },
    },
    autoPlayVideo: false,
  }
}

describe('window content publication', () => {
  test('drag, resize and chrome-only changes do not republish the content', () => {
    const before = content()
    const after = {
      ...before,
      definition: {
        ...before.definition!,
        layout: { bounds: { x: 100, y: 200, width: 900, height: 600 }, zIndex: 12 },
        tabPinned: true,
      },
      editableFolders: [...before.editableFolders],
      fileIconContext: { ...before.fileIconContext },
    }
    expect(windowContentEquals(before, after)).toBe(true)
  })

  test('navigation, target, title and source changes publish even for a hidden pane', () => {
    const before = { ...content(), visible: false, active: false }
    for (const change of [
      { initialState: { dir: '/pictures' } },
      { initialState: { viewing: '/books/book.pdf' } },
      { title: 'Renamed' },
      { source: { kind: 'local' as const, rootPath: '/another-root' } },
      { hermes: { sessionId: 'another-session' } },
      { type: 'viewer' as const },
    ]) {
      expect(
        windowContentEquals(before, {
          ...before,
          definition: { ...before.definition!, ...change },
        }),
      ).toBe(false)
    }
  })

  test('focus, visibility, permissions, icon state and replacement commands publish', () => {
    const before = content()
    for (const change of [
      { active: false },
      { visible: false },
      { autoPlayVideo: true },
      { editableFolders: [] },
      { knowledgeBases: ['/books'] },
      { fileIconContext: { ...before.fileIconContext, customIcons: { '/books': 'book' } } },
      { actions: { ...before.actions, viewer: { updateViewing: () => {} } } },
    ])
      expect(windowContentEquals(before, { ...before, ...change })).toBe(false)
  })
})
