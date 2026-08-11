import { describe, expect, test } from 'bun:test'
import type { ResourceSummary } from '@/lib/resource'
import {
  backfillLegacyResourcePin,
  backfillLegacyResourceWindow,
  legacyResourceAttemptKey,
  legacyResourceIsPending,
  legacyResourceLocatorForPin,
  legacyResourceLocatorForWindow,
  legacyResourceResolveUrl,
  reconcileResourceTargetPin,
  reconcileResourceTargetWindow,
  resourceInspectUrl,
  resourceTargetAttemptKey,
  resourceTargetIsPending,
} from '@/lib/resource-target-resolution'
import { MediaType } from '@/lib/types'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import type { WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'
import { reconcileResolvedWindowPresentation } from '@/src/lib/resource-window-resolution'

const moved: ResourceSummary = {
  ref: { libraryId: 'library-1', resourceId: 'resource-1' },
  locator: { sourceId: 'source-1', providerLocator: 'renamed/song.mp3' },
  legacyLocator: 'Library/renamed/song.mp3',
  version: 'opaque-provider-version',
  name: 'song.mp3',
  kind: 'file',
  presentation: 'audio',
  mimeType: 'audio/mpeg',
  size: 10,
  providerOperations: ['read', 'stream', 'download'],
  availability: 'present',
}

function viewer(): WorkspaceWindowDefinition {
  return {
    id: 'viewer-1',
    type: 'viewer',
    title: 'old.mp3',
    iconPath: 'Library/old.mp3',
    iconType: MediaType.AUDIO,
    source: { kind: 'local', rootPath: null },
    initialState: { dir: 'Library', viewing: 'Library/old.mp3' },
    resourceTarget: {
      ref: { libraryId: 'library-1', resourceId: 'resource-1' },
      legacyLocator: 'Library/old.mp3',
    },
  }
}

describe('persisted ResourceRef resolution', () => {
  test('characterizes path-only window and pin locators before lazy identity backfill', () => {
    const pathOnlyViewer = { ...viewer(), resourceTarget: undefined }
    const pathOnlyBrowser: WorkspaceWindowDefinition = {
      ...pathOnlyViewer,
      type: 'browser',
      initialState: { dir: 'Library/folder' },
    }
    const pin: WorkspaceTaskbarPin = {
      id: 'pin-1',
      path: 'Library/folder',
      title: 'folder',
      isDirectory: true,
      source: { kind: 'local' },
    }

    expect(legacyResourceLocatorForWindow(pathOnlyViewer)).toBe('Library/old.mp3')
    expect(legacyResourceLocatorForWindow(pathOnlyBrowser)).toBe('Library/folder')
    expect(legacyResourceLocatorForWindow(viewer())).toBeNull()
    expect(legacyResourceLocatorForPin(pin)).toBe('Library/folder')
    expect(
      legacyResourceLocatorForPin({ ...pin, resourceTarget: viewer().resourceTarget }),
    ).toBeNull()
    const attempts = new Set<string>()
    expect(legacyResourceIsPending('Library/folder', attempts, 'workspace-1')).toBe(true)
    attempts.add(legacyResourceAttemptKey('Library/folder', 'workspace-1'))
    expect(legacyResourceIsPending('Library/folder', attempts, 'workspace-1')).toBe(false)
    expect(legacyResourceIsPending(null, attempts, 'workspace-1')).toBe(false)
  })

  test('backfills durable Hermes sessions while excluding unbound drafts', () => {
    const draft: WorkspaceWindowDefinition = {
      id: 'hermes-draft',
      type: 'hermes',
      title: 'New Hermes session',
      iconPath: 'Hermes Sessions/session/ephemeral-draft',
      source: { kind: 'local' },
      initialState: {},
      hermes: { draftId: 'ephemeral-draft' },
    }
    const bound: WorkspaceWindowDefinition = {
      ...draft,
      id: 'hermes-bound',
      iconPath: 'Hermes Sessions\\session\\durable-1',
      hermes: { sessionId: 'durable-1' },
    }
    const session: ResourceSummary = {
      ...moved,
      ref: { libraryId: 'hermes', resourceId: 'session-durable-1' },
      locator: { sourceId: 'hermes', providerLocator: 'session/durable-1' },
      legacyLocator: 'Hermes Sessions/session/durable-1',
      name: 'Durable session',
      kind: 'conversation',
      presentation: 'conversation',
      mimeType: undefined,
      openTarget: { type: 'hermesSession', sessionId: 'durable-1', readOnly: false },
    }

    expect(legacyResourceLocatorForWindow(draft)).toBeNull()
    expect(legacyResourceLocatorForWindow({ ...draft, hermes: { sessionId: '   ' } })).toBeNull()
    expect(legacyResourceLocatorForWindow(bound)).toBe('Hermes Sessions/session/durable-1')
    expect(
      legacyResourceLocatorForWindow({
        ...bound,
        iconPath: 'Hermes Sessions/session/different',
      }),
    ).toBe('Hermes Sessions/session/durable-1')
    expect(
      backfillLegacyResourceWindow(bound, 'Hermes Sessions/session/durable-1', session),
    ).toMatchObject({
      title: 'Durable session',
      iconPath: 'Hermes Sessions/session/durable-1',
      hermes: { sessionId: 'durable-1' },
      resourceTarget: {
        ref: session.ref,
        legacyLocator: 'Hermes Sessions/session/durable-1',
      },
    })
  })

  test('backfills Library root window and pin with empty compatibility locator', () => {
    const root: ResourceSummary = {
      ...moved,
      ref: { libraryId: 'library-1', resourceId: 'library-root' },
      locator: { sourceId: 'catalog', providerLocator: '' },
      legacyLocator: '',
      name: 'Library',
      kind: 'library',
      presentation: 'browse',
      mimeType: undefined,
      providerOperations: ['browse'],
    }
    const rootWindow: WorkspaceWindowDefinition = {
      ...viewer(),
      type: 'browser',
      title: 'Old root',
      iconPath: '',
      initialState: { dir: '' },
      resourceTarget: undefined,
    }
    const rootPin: WorkspaceTaskbarPin = {
      id: 'root-pin',
      path: '',
      title: 'Old root',
      isDirectory: true,
      source: { kind: 'local' },
    }

    expect(legacyResourceLocatorForWindow(rootWindow)).toBe('')
    expect(legacyResourceLocatorForPin(rootPin)).toBe('')
    expect(backfillLegacyResourceWindow(rootWindow, '', root)).toMatchObject({
      title: 'Library',
      iconPath: '',
      initialState: { dir: '' },
      resourceTarget: { ref: root.ref, legacyLocator: '' },
    })
    expect(backfillLegacyResourcePin(rootPin, '', root)).toMatchObject({
      path: '',
      title: 'Library',
      isDirectory: true,
      resourceTarget: { ref: root.ref, legacyLocator: '' },
    })
  })

  test('backfills path-only state with stable identity and current compatibility locator', () => {
    const pathOnly = { ...viewer(), resourceTarget: undefined }
    expect(backfillLegacyResourceWindow(pathOnly, 'Library/old.mp3', moved)).toMatchObject({
      title: 'song.mp3',
      iconPath: 'Library/renamed/song.mp3',
      initialState: { dir: 'Library/renamed', viewing: 'Library/renamed/song.mp3' },
      resourceTarget: {
        ref: moved.ref,
        legacyLocator: 'Library/renamed/song.mp3',
      },
    })

    const pin: WorkspaceTaskbarPin = {
      id: 'pin-1',
      path: 'Library/old.mp3',
      title: 'old.mp3',
      isDirectory: false,
      source: { kind: 'local' },
    }
    expect(backfillLegacyResourcePin(pin, 'Library/old.mp3', moved)).toMatchObject({
      path: 'Library/renamed/song.mp3',
      resourceTarget: { ref: moved.ref, legacyLocator: 'Library/renamed/song.mp3' },
    })
  })

  test('backfills missing identity without rebinding reused legacy path', () => {
    const pathOnly = { ...viewer(), resourceTarget: undefined }
    const missing = { ...moved, availability: 'missing' as const }
    expect(backfillLegacyResourceWindow(pathOnly, 'Library/old.mp3', missing)).toMatchObject({
      iconPath: 'Library/old.mp3',
      initialState: { viewing: 'Library/old.mp3' },
      resourceTarget: {
        ref: moved.ref,
        legacyLocator: 'Library/old.mp3',
        availability: 'missing',
      },
    })
  })

  test('keeps restored targets pending until current session attempts inspect', () => {
    const target = viewer().resourceTarget!
    const attempted = new Set([resourceTargetAttemptKey(target, 'previous-session')])
    expect(resourceTargetIsPending(target, attempted, 'current-session')).toBe(true)
    attempted.add(resourceTargetAttemptKey(target, 'current-session'))
    expect(resourceTargetIsPending(target, attempted, 'current-session')).toBe(false)
    expect(
      resourceTargetIsPending({ ...target, availability: 'missing' }, new Set(), 'current-session'),
    ).toBe(false)
    expect(resourceTargetIsPending(undefined, new Set(), 'current-session')).toBe(false)
  })

  test('updates compatibility locator after an external move without replacing identity', () => {
    expect(reconcileResourceTargetWindow(viewer(), moved)).toMatchObject({
      title: 'song.mp3',
      iconPath: 'Library/renamed/song.mp3',
      initialState: { dir: 'Library/renamed', viewing: 'Library/renamed/song.mp3' },
      resourceTarget: {
        ref: { libraryId: 'library-1', resourceId: 'resource-1' },
        legacyLocator: 'Library/renamed/song.mp3',
      },
    })
  })

  test('replans retained identity when current presentation changes in Workspace and Canvas', () => {
    const staleVideo = {
      ...viewer(),
      viewerId: 'video-player' as const,
      iconType: MediaType.VIDEO,
    }
    const audio = { ...moved, presentation: 'audio' as const, mimeType: 'audio/mpeg' }
    expect(
      reconcileResolvedWindowPresentation(staleVideo, audio, {
        surface: 'workspace',
        scope: { kind: 'grant', id: 'share-token' },
      }),
    ).toMatchObject({ viewerId: 'audio-player', iconType: MediaType.AUDIO })

    const stalePdf = {
      ...viewer(),
      viewerId: 'pdf-reader' as const,
      iconType: MediaType.PDF,
      initialState: { ...viewer().initialState, readerKind: 'pdf' as const },
    }
    const text = reconcileResolvedWindowPresentation(
      stalePdf,
      { ...moved, presentation: 'text', mimeType: 'text/plain' },
      { surface: 'canvas', scope: { kind: 'owner' } },
    )
    expect(text).toMatchObject({ viewerId: 'text-viewer', iconType: MediaType.TEXT })
    expect(text.initialState.readerKind).toBeUndefined()

    expect(
      reconcileResolvedWindowPresentation(
        stalePdf,
        { ...moved, presentation: 'book', mimeType: 'application/epub+zip' },
        { surface: 'workspace', scope: { kind: 'owner' } },
      ),
    ).toMatchObject({
      viewerId: 'book-reader',
      iconType: MediaType.BOOK,
      initialState: { readerKind: 'book' },
    })
  })

  test('updates browser and pin targets from kind instead of path inference', () => {
    const folder = { ...moved, kind: 'folder' as const, presentation: 'browse' as const }
    const browser: WorkspaceWindowDefinition = {
      ...viewer(),
      type: 'browser',
      initialState: { dir: 'Library/old' },
    }
    const pin: WorkspaceTaskbarPin = {
      id: 'pin-1',
      path: 'Library/old',
      title: 'old',
      isDirectory: true,
      source: { kind: 'local' },
      resourceTarget: viewer().resourceTarget,
    }

    expect(reconcileResourceTargetWindow(browser, folder).initialState.dir).toBe(
      'Library/renamed/song.mp3',
    )
    expect(reconcileResourceTargetPin(pin, moved)).toMatchObject({
      path: 'Library/renamed/song.mp3',
      title: 'song.mp3',
      isDirectory: false,
    })
  })

  test('ignores mismatched or locator-free inspect responses', () => {
    expect(
      reconcileResourceTargetWindow(viewer(), {
        ...moved,
        ref: { ...moved.ref, resourceId: 'different' },
      }),
    ).toEqual(viewer())
    expect(reconcileResourceTargetWindow(viewer(), { ...moved, legacyLocator: undefined })).toEqual(
      viewer(),
    )
  })

  test('marks unavailable restored targets without replacing rollback locator', () => {
    const missing = reconcileResourceTargetWindow(viewer(), {
      ...moved,
      availability: 'missing',
      legacyLocator: 'Library/reused/song.mp3',
    })
    expect(missing).toMatchObject({
      iconPath: 'Library/old.mp3',
      initialState: { viewing: 'Library/old.mp3' },
      resourceTarget: {
        ref: { libraryId: 'library-1', resourceId: 'resource-1' },
        legacyLocator: 'Library/old.mp3',
        availability: 'missing',
      },
    })

    const pin: WorkspaceTaskbarPin = {
      id: 'pin-1',
      path: 'Library/old.mp3',
      title: 'old.mp3',
      isDirectory: false,
      source: { kind: 'local' },
      resourceTarget: viewer().resourceTarget,
    }
    expect(
      reconcileResourceTargetPin(pin, { ...moved, availability: 'sourceUnavailable' }),
    ).toEqual({
      ...pin,
      resourceTarget: { ...pin.resourceTarget!, availability: 'sourceUnavailable' },
    })
  })

  test('keeps Grant token in access URL and out of ResourceRef', () => {
    const target = viewer().resourceTarget!
    expect(resourceInspectUrl(target, { kind: 'owner' })).toBe(
      '/api/resources/inspect?libraryId=library-1&resourceId=resource-1&surface=workspace',
    )
    expect(resourceInspectUrl(target, { kind: 'grant', token: 'secret token' })).toBe(
      '/api/share/secret%20token/resources/inspect?libraryId=library-1&resourceId=resource-1',
    )
    expect(target.ref).toEqual({ libraryId: 'library-1', resourceId: 'resource-1' })
    expect(
      legacyResourceResolveUrl('Shared/old file.md', { kind: 'owner', surface: 'canvas' }),
    ).toBe('/api/resources/resolve?legacyLocator=Shared%2Fold+file.md&surface=canvas')
    expect(
      legacyResourceResolveUrl('Shared/old file.md', {
        kind: 'grant',
        token: 'secret token',
      }),
    ).toBe('/api/share/secret%20token/resources/resolve?legacyLocator=Shared%2Fold+file.md')
  })
})
