import { describe, expect, test } from 'bun:test'
import type { ResourceSummary } from '@/lib/resource'
import {
  reconcileResourceTargetPin,
  reconcileResourceTargetWindow,
  resourceInspectUrl,
} from '@/lib/resource-target-resolution'
import { MediaType } from '@/lib/types'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import type { WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'

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

  test('ignores mismatched, unavailable, or locator-free inspect responses', () => {
    expect(
      reconcileResourceTargetWindow(viewer(), {
        ...moved,
        ref: { ...moved.ref, resourceId: 'different' },
      }),
    ).toEqual(viewer())
    expect(reconcileResourceTargetWindow(viewer(), { ...moved, availability: 'missing' })).toEqual(
      viewer(),
    )
    expect(reconcileResourceTargetWindow(viewer(), { ...moved, legacyLocator: undefined })).toEqual(
      viewer(),
    )
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
  })
})
