import { describe, expect, test } from 'bun:test'
import { MediaType, type FileItem } from '@/lib/types'
import {
  explicitVirtualResourceKey,
  planWorkspaceBrowserResourceOpen,
  workspaceBrowserOpenAction,
} from '@/src/workspace/workspace-browser-resource-open'
import { BUILT_IN_RENDERER_ID } from '@/src/features/open/renderer-registry'
import type { OpenSurface } from '@/src/features/open/open-resource'

function file(type: FileItem['type'], extension: string, isDirectory = false): FileItem {
  const name = isDirectory ? 'Folder' : `item.${extension || 'bin'}`
  return {
    name,
    path: isDirectory ? name : `Media/${name}`,
    type,
    size: 42,
    extension,
    isDirectory,
  }
}

describe('WorkspaceBrowserPane resource opener boundary', () => {
  test('maps every current FileItem kind to existing callback behavior', () => {
    const cases = [
      [file(MediaType.FOLDER, '', true), 'navigate', undefined],
      [file(MediaType.VIDEO, 'mp4'), 'play', BUILT_IN_RENDERER_ID.video],
      [file(MediaType.AUDIO, 'mp3'), 'play', BUILT_IN_RENDERER_ID.audio],
      [file(MediaType.IMAGE, 'png'), 'view', BUILT_IN_RENDERER_ID.image],
      [file(MediaType.TEXT, 'md'), 'view', BUILT_IN_RENDERER_ID.text],
      [file(MediaType.PDF, 'pdf'), 'view', BUILT_IN_RENDERER_ID.pdf],
      [file(MediaType.BOOK, 'epub'), 'view', BUILT_IN_RENDERER_ID.book],
      [file(MediaType.OTHER, 'bin'), 'unsupported', BUILT_IN_RENDERER_ID.unsupported],
    ] as const

    for (const [input, action, renderer] of cases) {
      const result = planWorkspaceBrowserResourceOpen(input, 'default', {
        surface: 'workspace',
        disposition: 'window',
      })
      expect(workspaceBrowserOpenAction(result.plan), input.type).toBe(action)
      if (renderer) expect(result.plan).toMatchObject({ status: 'ready', renderer })
    }
  })

  test('keeps ambiguous OGG video-first classification', () => {
    const result = planWorkspaceBrowserResourceOpen(file(MediaType.AUDIO, 'ogg'), 'default', {
      surface: 'workspace',
      disposition: 'window',
    })

    expect(result.resource).toMatchObject({ mime: 'video/ogg', presentation: 'audio' })
    expect(result.plan).toMatchObject({
      status: 'ready',
      renderer: BUILT_IN_RENDERER_ID.video,
    })
    expect(workspaceBrowserOpenAction(result.plan)).toBe('play')
  })

  test('produces one semantic plan for Workspace and Canvas hosts', () => {
    const input = file(MediaType.IMAGE, 'jpeg')
    const surfaces: readonly OpenSurface[] = ['library', 'workspace', 'canvas']
    const plans = surfaces.map(
      (surface) =>
        planWorkspaceBrowserResourceOpen(input, 'view', {
          surface,
          disposition: 'window',
        }).plan,
    )

    expect(plans).toEqual([plans[0], plans[0], plans[0]])
  })

  test('does not project virtual provider ids from legacy paths', () => {
    const virtual = { ...file(MediaType.OTHER, ''), isVirtual: true }
    expect(() =>
      planWorkspaceBrowserResourceOpen(virtual, 'default', {
        surface: 'workspace',
        disposition: 'window',
      }),
    ).toThrow('non-virtual')
    expect(
      explicitVirtualResourceKey({ provider: 'fixture', id: 'opaque/../session:one' }),
    ).toEqual({
      provider: 'fixture',
      id: 'opaque/../session:one',
    })
    expect(explicitVirtualResourceKey({ provider: 'fixture' })).toBeNull()
  })
})
