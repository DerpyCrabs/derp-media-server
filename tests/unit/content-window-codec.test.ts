import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import { hermesResourceKey } from '@/src/integrations/hermes/module'
import {
  contentInstanceFromCurrentWindow,
  currentWindowProjectionForContent,
  currentWindowFromPersistedContent,
  persistedContentForInstance,
  persistedContentFromCurrentWindow,
  projectContentOntoCurrentWindow,
} from '@/src/integrations/current-window-content'

describe('content window host projection', () => {
  test('encodes live browser and viewer windows as new-only filesystem envelopes', () => {
    const browser = {
      id: 'browser-1',
      type: 'browser',
      title: 'Pictures',
      source: { kind: 'local' },
      initialState: { dir: 'Pictures' },
    }
    const viewer = {
      id: 'viewer-1',
      type: 'viewer',
      title: 'cover.jpg',
      source: { kind: 'local' },
      iconPath: 'Pictures/cover.jpg',
      iconType: MediaType.IMAGE,
      initialState: { viewing: 'Pictures/cover.jpg' },
    }

    const browserEnvelope = persistedContentFromCurrentWindow(browser)
    const viewerEnvelope = persistedContentFromCurrentWindow(viewer)

    expect(browserEnvelope).toMatchObject({
      schemaVersion: 1,
      codec: 'filesystem.content',
      codecVersion: 1,
      payload: { kind: 'explorer', id: 'browser-1' },
    })
    expect(viewerEnvelope).toMatchObject({
      schemaVersion: 1,
      codec: 'filesystem.content',
      codecVersion: 1,
      payload: { kind: 'resource', id: 'viewer-1', renderer: 'image-viewer' },
    })
    expect(JSON.stringify(browserEnvelope)).not.toContain('initialState')
    expect(JSON.stringify(viewerEnvelope)).not.toContain('iconPath')

    expect(currentWindowFromPersistedContent(browserEnvelope, browser)).toMatchObject({
      ok: true,
      projection: { type: 'browser', initialState: { dir: 'Pictures' } },
    })
    expect(currentWindowFromPersistedContent(viewerEnvelope, viewer)).toMatchObject({
      ok: true,
      projection: {
        type: 'viewer',
        iconPath: 'Pictures/cover.jpg',
        iconType: MediaType.IMAGE,
        initialState: { viewing: 'Pictures/cover.jpg' },
      },
    })
  })

  test('encodes durable Hermes identity without persisting fake paths or drafts', () => {
    const legacy = {
      id: 'hermes-1',
      type: 'integration',
      title: 'Session one',
      source: { kind: 'local' },
      initialState: {},
      runtimeContent: {
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
      },
    }

    const envelope = persistedContentFromCurrentWindow(legacy)
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      codec: 'hermes.content',
      payload: { kind: 'chat', id: 'hermes-1', sessionId: 'session-1' },
    })
    expect(JSON.stringify(envelope)).not.toMatch(/Hermes Sessions|draftId/)
    expect(currentWindowFromPersistedContent(envelope, legacy)).toMatchObject({
      ok: true,
      projection: {
        type: 'integration',
        runtimeContent: {
          type: 'integration',
          state: { sessionId: 'session-1', cwd: '/work', readOnly: true },
        },
      },
    })
  })

  test('projects canonical Hermes Explorer content without persisting its compatibility path', () => {
    const instance = {
      id: 'hermes-browser',
      type: 'explorer' as const,
      location: hermesResourceKey('project', 'project-1'),
    }
    const projected = projectContentOntoCurrentWindow(
      { id: instance.id, title: 'Browser', layout: { zIndex: 4 } },
      instance,
    )

    expect(projected).toMatchObject({
      id: 'hermes-browser',
      type: 'browser',
      title: 'project-1',
      iconPath: 'Hermes Sessions/project/project-1',
      iconIsVirtual: true,
      initialState: { dir: 'Hermes Sessions/project/project-1' },
      layout: { zIndex: 4 },
      content: {
        codec: 'hermes.content',
        payload: {
          kind: 'explorer',
          id: 'hermes-browser',
          location: instance.location,
        },
      },
    })
    expect(JSON.stringify(projected?.content)).not.toContain('Hermes Sessions')
    expect(projected && contentInstanceFromCurrentWindow(projected)).toEqual(instance)
  })

  test('retains unknown envelopes as recoverable content', () => {
    const unknown = {
      schemaVersion: 1 as const,
      codec: 'future.content',
      codecVersion: 7,
      payload: { opaque: true },
    }
    const result = currentWindowFromPersistedContent(unknown, {
      id: 'future-1',
      title: 'Future pane',
    })

    expect(result).toEqual({
      ok: false,
      reason: 'Unknown content codec: future.content',
      recoverable: unknown,
    })
  })

  test('persists live navigation after restoring a content envelope', () => {
    const original = persistedContentFromCurrentWindow({
      id: 'browser-1',
      type: 'browser',
      initialState: { dir: 'Docs' },
    })!
    const restored = currentWindowFromPersistedContent(original, { id: 'browser-1' })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return

    const navigated = persistedContentFromCurrentWindow({
      id: 'browser-1',
      ...restored.projection,
      content: original,
      initialState: { ...restored.projection.initialState, dir: 'Photos' },
    })

    expect(navigated).toMatchObject({
      codec: 'filesystem.content',
      payload: { kind: 'explorer', id: 'browser-1', address: { path: 'Photos' } },
    })
  })

  test('adapts live windows and runtime replacements without exposing provider logic to hosts', () => {
    const draft = {
      id: 'hermes-draft',
      type: 'integration',
      title: 'New session',
      runtimeContent: {
        id: 'hermes-draft',
        type: 'integration' as const,
        integration: 'hermes',
        view: 'chat',
        state: { draftId: 'draft-1', cwd: '/work', readOnly: false },
      },
    }
    const instance = contentInstanceFromCurrentWindow(draft)

    expect(instance).toMatchObject({
      id: 'hermes-draft',
      type: 'integration',
      integration: 'hermes',
      state: { draftId: 'draft-1', cwd: '/work' },
    })
    expect(instance && currentWindowProjectionForContent(instance)).toMatchObject({
      type: 'integration',
      runtimeContent: {
        type: 'integration',
        state: { draftId: 'draft-1', cwd: '/work', readOnly: false },
      },
    })
    expect(instance && persistedContentForInstance(instance)).toBeNull()
    const projected = instance
      ? projectContentOntoCurrentWindow({ ...draft, layout: { zIndex: 7 } }, instance)
      : null
    expect(projected).toMatchObject({
      id: 'hermes-draft',
      type: 'integration',
      layout: { zIndex: 7 },
      runtimeContent: {
        type: 'integration',
        state: { draftId: 'draft-1', cwd: '/work', readOnly: false },
      },
    })
    expect(projected?.content).toBeUndefined()
  })
})
