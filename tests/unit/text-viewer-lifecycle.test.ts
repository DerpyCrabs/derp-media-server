import { describe, expect, test } from 'bun:test'
import { filesystemResourceKey } from '@/lib/domain/resource'
import { BUILT_IN_RENDERER_ID } from '@/src/features/open/renderer-registry'
import {
  canCloseTextViewerContent,
  createTextViewerCloseController,
  registerTextViewerCloseController,
} from '@/src/features/viewer/text-viewer-lifecycle'
import { createFilesystemIntegrationModule } from '@/src/integrations/filesystem/module'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('text viewer close lifecycle', () => {
  test('keeps manual autosave-off discard behavior without writing', async () => {
    let saves = 0
    const controller = createTextViewerCloseController({
      autoSaveEnabled: () => false,
      dirty: () => true,
      editable: () => true,
      conflict: () => false,
      cancelScheduledSave() {},
      awaitPendingSaves: async () => {},
      save: async () => {
        saves += 1
      },
    })

    expect(await controller.canClose()).toBe(true)
    expect(saves).toBe(0)
  })

  test('waits for an in-flight save before allowing host close', async () => {
    const pending = deferred()
    let dirty = true
    let saves = 0
    let settled = false
    const controller = createTextViewerCloseController({
      autoSaveEnabled: () => true,
      dirty: () => dirty,
      editable: () => true,
      conflict: () => false,
      cancelScheduledSave() {},
      awaitPendingSaves: async () => {
        await pending.promise
        dirty = false
      },
      save: async () => {
        saves += 1
      },
    })

    const closing = controller.canClose().then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    pending.resolve()
    expect(await closing).toBe(true)
    expect(saves).toBe(0)
  })

  test('filesystem lifecycle delegates dirty close to the mounted text controller', async () => {
    let dirty = true
    let saves = 0
    const controller = createTextViewerCloseController({
      autoSaveEnabled: () => true,
      dirty: () => dirty,
      editable: () => true,
      conflict: () => false,
      cancelScheduledSave() {},
      awaitPendingSaves: async () => {},
      save: async () => {
        saves += 1
        dirty = false
      },
    })
    const unregister = registerTextViewerCloseController('text-window', controller)
    const instance = {
      id: 'text-window',
      type: 'resource' as const,
      resource: filesystemResourceKey('media', 'Notes/file.txt'),
      renderer: BUILT_IN_RENDERER_ID.text,
    }
    const lifecycle = createFilesystemIntegrationModule().lifecycles?.find((candidate) =>
      candidate.supports(instance),
    )

    expect(await lifecycle?.canClose?.(instance)).toBe(true)
    expect(saves).toBe(1)
    unregister()
    expect(await canCloseTextViewerContent(instance.id)).toBe(true)
  })
})
