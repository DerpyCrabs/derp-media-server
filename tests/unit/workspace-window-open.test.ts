import { expect, test } from 'bun:test'
import { MediaType, type FileItem } from '@/lib/files/types'
import {
  appendWorkspaceWindow,
  planWorkspaceWindowOpen,
  workspaceWindowId,
} from '@/workspace/model/workspace-window-open'

const image: FileItem = {
  name: 'cover.jpg',
  path: 'books/cover.jpg',
  type: MediaType.IMAGE,
  size: 42,
  extension: 'jpg',
  isDirectory: false,
}

const folder: FileItem = {
  name: 'Manual',
  path: 'books/Manual',
  type: MediaType.FOLDER,
  size: 0,
  extension: '',
  isDirectory: true,
}

test('browser open plan owns title, icon, source, and parent identity', () => {
  const plan = planWorkspaceWindowOpen({
    windows: [],
    id: 'workspace-window-4',
    reuseExisting: false,
    intent: {
      kind: 'browser',
      dir: 'Favorites',
      source: { kind: 'local', rootPath: 'media-b' },
      openedFromWindowId: 'browser-a',
      tabGroupId: 'group-a',
    },
    layout: { bounds: { x: 10, y: 20, width: 500, height: 400 }, zIndex: 7 },
  })

  expect(plan).toEqual({
    kind: 'create',
    definition: {
      id: 'workspace-window-4',
      type: 'browser',
      title: 'Favorites',
      iconName: null,
      iconPath: 'Favorites',
      iconType: MediaType.FOLDER,
      iconIsVirtual: true,
      source: { kind: 'local', rootPath: 'media-b' },
      initialState: { dir: 'Favorites' },
      tabGroupId: 'group-a',
      openedFromWindowId: 'browser-a',
      layout: { bounds: { x: 10, y: 20, width: 500, height: 400 }, zIndex: 7 },
    },
  })
})

test('workspace window ids are renderer-independent', () => {
  expect(workspaceWindowId(7)).toBe('workspace-window-7')
})

test('window append owns counters, focus, and source group initialization', () => {
  const source = {
    id: 'browser-a',
    type: 'browser' as const,
    title: 'Browser',
    source: { kind: 'local' as const },
    initialState: {},
  }
  const created = {
    id: 'workspace-window-2',
    type: 'viewer' as const,
    title: image.name,
    source: { kind: 'local' as const },
    initialState: { viewing: image.path },
    tabGroupId: 'browser-a',
  }

  const next = appendWorkspaceWindow(
    {
      workspaceType: 'desktop',
      windows: [source],
      activeWindowId: source.id,
      activeTabMap: {},
      nextWindowId: 2,
    },
    created,
    { groupSourceWindowId: source.id },
  )

  expect(next.windows).toEqual([{ ...source, tabGroupId: source.id }, created])
  expect(next.nextWindowId).toBe(3)
  expect(next.activeWindowId).toBe(created.id)
  expect(next.activeTabMap).toEqual({ 'browser-a': created.id })
})

for (const [renderer, layout] of [
  ['desktop', { bounds: { x: 10, y: 20, width: 500, height: 400 }, zIndex: 7 }],
  ['canvas', { bounds: { x: -40, y: 90, width: 640, height: 480 }, zIndex: 23 }],
] as const) {
  test(`${renderer} viewer plan has the shared viewer definition`, () => {
    const plan = planWorkspaceWindowOpen({
      windows: [],
      id: workspaceWindowId(2),
      reuseExisting: false,
      intent: {
        kind: 'viewer',
        file: image,
        source: { kind: 'local', rootPath: 'media-a' },
        openedFromWindowId: 'browser-a',
      },
      layout,
    })

    expect(plan).toEqual({
      kind: 'create',
      definition: {
        id: 'workspace-window-2',
        type: 'viewer',
        title: 'cover.jpg',
        iconName: null,
        iconPath: 'books/cover.jpg',
        iconType: MediaType.IMAGE,
        iconIsVirtual: false,
        source: { kind: 'local', rootPath: 'media-a' },
        initialState: { dir: 'books', viewing: 'books/cover.jpg' },
        tabGroupId: null,
        openedFromWindowId: 'browser-a',
        layout,
      },
    })
  })
}

test('reader plan owns reader kind and source-aware dedupe', () => {
  const source = { kind: 'local' as const, rootPath: 'media-a' }
  const existing = planWorkspaceWindowOpen({
    windows: [
      {
        id: 'reader-a',
        type: 'viewer',
        title: 'Manual',
        source,
        initialState: {
          dir: 'books',
          viewing: 'books/Manual',
          readerKind: 'folder',
        },
      },
    ],
    id: workspaceWindowId(8),
    reuseExisting: true,
    intent: { kind: 'reader', file: folder, readerKind: 'folder', source },
  })
  expect(existing).toEqual({ kind: 'existing', windowId: 'reader-a' })

  const differentSource = planWorkspaceWindowOpen({
    windows: [
      {
        id: 'reader-a',
        type: 'viewer',
        title: 'Manual',
        source,
        initialState: {
          dir: 'books',
          viewing: 'books/Manual',
          readerKind: 'folder',
        },
      },
    ],
    id: workspaceWindowId(8),
    reuseExisting: true,
    intent: {
      kind: 'reader',
      file: folder,
      readerKind: 'folder',
      source: { kind: 'local', rootPath: 'media-b' },
    },
  })
  expect(differentSource.kind).toBe('create')
})

test('Hermes plans dedupe durable sessions but never drafts', () => {
  const source = { kind: 'local' as const, rootPath: null }
  const existingSession = {
    id: 'hermes-a',
    type: 'hermes' as const,
    title: 'Session A',
    source,
    initialState: {},
    hermes: { sessionId: 'session-a' },
  }
  const session = planWorkspaceWindowOpen({
    windows: [existingSession],
    id: workspaceWindowId(9),
    reuseExisting: true,
    intent: {
      kind: 'hermes',
      file: { ...image, name: 'Session A', path: 'Hermes Sessions/session/session-a' },
      target: {
        provider: 'hermes',
        type: 'hermesSession',
        sessionId: 'session-a',
        readOnly: true,
      },
      source,
    },
  })
  expect(session).toEqual({ kind: 'existing', windowId: 'hermes-a' })

  const draft = planWorkspaceWindowOpen({
    windows: [existingSession],
    id: workspaceWindowId(10),
    reuseExisting: true,
    intent: {
      kind: 'hermes',
      file: { ...image, name: 'Draft', path: 'Hermes Sessions/draft' },
      target: {
        provider: 'hermes',
        type: 'hermesDraft',
        projectPath: 'books',
        readOnly: false,
      },
      draftId: 'draft-a',
      source,
    },
  })
  expect(draft).toEqual({
    kind: 'create',
    definition: {
      id: 'workspace-window-10',
      type: 'hermes',
      title: 'New Hermes session',
      iconName: null,
      iconPath: 'Hermes Sessions/draft',
      iconType: MediaType.OTHER,
      iconIsVirtual: true,
      source,
      initialState: {},
      tabGroupId: null,
      hermes: {
        sessionId: undefined,
        draftId: 'draft-a',
        cwd: 'books',
        readOnly: false,
      },
    },
  })
})
