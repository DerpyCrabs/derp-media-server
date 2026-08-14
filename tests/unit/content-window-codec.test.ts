import { describe, expect, test } from 'bun:test'
import { filesystemResourceKey } from '@/lib/domain/resource'
import { hermesResourceKey } from '@/src/integrations/hermes/module'
import {
  contentInstanceFromCurrentWindow,
  contentWindowWithInstance,
  currentWindowFromPersistedContent,
  persistedContentForInstance,
  persistedContentFromCurrentWindow,
} from '@/src/integrations/current-window-content'

describe('content window authority', () => {
  test('encodes and restores filesystem ContentInstance envelopes', () => {
    const browserInstance = {
      id: 'browser-1',
      type: 'explorer' as const,
      location: filesystemResourceKey('configured-default', 'Pictures'),
    }
    const viewerInstance = {
      id: 'viewer-1',
      type: 'resource' as const,
      resource: filesystemResourceKey('configured-default', 'Pictures/cover.jpg'),
      renderer: 'image-viewer',
    }
    const browser = { id: browserInstance.id, contentInstance: browserInstance }
    const viewer = { id: viewerInstance.id, contentInstance: viewerInstance }

    const browserEnvelope = persistedContentFromCurrentWindow(browser)
    const viewerEnvelope = persistedContentFromCurrentWindow(viewer)

    expect(browserEnvelope).toMatchObject({
      schemaVersion: 1,
      codec: 'filesystem.content',
      codecVersion: 1,
      payload: { kind: 'explorer', id: 'browser-1', address: { path: 'Pictures' } },
    })
    expect(viewerEnvelope).toMatchObject({
      schemaVersion: 1,
      codec: 'filesystem.content',
      codecVersion: 1,
      payload: { kind: 'resource', id: 'viewer-1', renderer: 'image-viewer' },
    })
    expect(currentWindowFromPersistedContent(browserEnvelope, browser)).toEqual({
      ok: true,
      instance: browserInstance,
    })
    expect(currentWindowFromPersistedContent(viewerEnvelope, viewer)).toEqual({
      ok: true,
      instance: viewerInstance,
    })
  })

  test('persists durable Hermes identity without fake paths or draft state', () => {
    const instance = {
      id: 'hermes-1',
      type: 'integration' as const,
      integration: 'hermes',
      view: 'chat',
      state: {
        sessionId: 'session-1',
        draftId: 'runtime-draft',
        cwd: '/work',
        readOnly: true,
      },
    }
    const envelope = persistedContentFromCurrentWindow({
      id: instance.id,
      contentInstance: instance,
    })

    expect(envelope).toMatchObject({
      schemaVersion: 1,
      codec: 'hermes.content',
      payload: { kind: 'chat', id: 'hermes-1', sessionId: 'session-1' },
    })
    expect(JSON.stringify(envelope)).not.toMatch(/Hermes Sessions|draftId/)
    expect(currentWindowFromPersistedContent(envelope, { id: instance.id })).toMatchObject({
      ok: true,
      instance: {
        type: 'integration',
        state: { sessionId: 'session-1', cwd: '/work', readOnly: true },
      },
    })
  })

  test('hosts opaque Hermes Explorer content without a fake path', () => {
    const instance = {
      id: 'hermes-browser',
      type: 'explorer' as const,
      location: hermesResourceKey('project', 'project-1'),
    }
    const hosted = contentWindowWithInstance(
      { id: instance.id, title: 'Browser', layout: { zIndex: 4 } },
      instance,
    )

    expect(hosted).toMatchObject({
      id: instance.id,
      title: 'project-1',
      layout: { zIndex: 4 },
      contentInstance: instance,
      content: {
        codec: 'hermes.content',
        payload: { kind: 'explorer', id: instance.id, location: instance.location },
      },
    })
    expect(JSON.stringify(hosted)).not.toMatch(/Hermes Sessions|initialState|iconPath/)
    expect(hosted && contentInstanceFromCurrentWindow(hosted)).toEqual(instance)
  })

  test('retains unknown envelopes as recoverable content', () => {
    const unknown = {
      schemaVersion: 1 as const,
      codec: 'future.content',
      codecVersion: 7,
      payload: { opaque: true },
    }
    expect(currentWindowFromPersistedContent(unknown, { id: 'future-1' })).toEqual({
      ok: false,
      reason: 'Unknown content codec: future.content',
      recoverable: unknown,
    })
  })

  test('live ContentInstance navigation overrides its previous envelope', () => {
    const original = persistedContentForInstance({
      id: 'browser-1',
      type: 'explorer',
      location: filesystemResourceKey('configured-default', 'Docs'),
    })!
    const navigated = persistedContentFromCurrentWindow({
      id: 'browser-1',
      content: original,
      contentInstance: {
        id: 'browser-1',
        type: 'explorer',
        location: filesystemResourceKey('configured-default', 'Photos'),
      },
    })

    expect(navigated).toMatchObject({
      codec: 'filesystem.content',
      payload: { kind: 'explorer', id: 'browser-1', address: { path: 'Photos' } },
    })
  })

  test('keeps unsaved integration drafts live but not persisted', () => {
    const instance = {
      id: 'hermes-draft',
      type: 'integration' as const,
      integration: 'hermes',
      view: 'chat',
      state: { draftId: 'draft-1', cwd: '/work', readOnly: false },
    }
    const hosted = contentWindowWithInstance(
      { id: instance.id, title: 'New session', layout: { zIndex: 7 } },
      instance,
    )

    expect(contentInstanceFromCurrentWindow(hosted!)).toEqual(instance)
    expect(persistedContentForInstance(instance)).toBeNull()
    expect(hosted).toMatchObject({ contentInstance: instance, layout: { zIndex: 7 } })
    expect(hosted?.content).toBeUndefined()
  })
})
