import { describe, expect, test } from 'bun:test'
import { resourceKey } from '@/lib/domain/resource'
import {
  createCanvasHost,
  createLibraryHost,
  createWorkspaceHost,
} from '@/src/features/content/hosts'
import type { HostOpenPlan } from '@/src/features/content/contracts'
import type { OpenDisposition } from '@/src/features/open/open-resource'

function plan<const TDisposition extends OpenDisposition>(
  disposition: TDisposition,
): HostOpenPlan<TDisposition> {
  return {
    status: 'ready',
    kind: 'render',
    resource: resourceKey('fixture', 'item'),
    renderer: 'fixture.renderer',
    intent: 'default',
    disposition,
  }
}

describe('surface content hosts', () => {
  test('routes placement through surface callbacks without geometry', () => {
    const calls: string[] = []
    const common = {
      close: (id: string) => calls.push(`close:${id}`),
      focus: (id: string) => calls.push(`focus:${id}`),
    }
    const library = createLibraryHost({
      ...common,
      replace: () => calls.push('library:replace'),
      modal: () => calls.push('library:modal'),
      fullscreen: () => calls.push('library:fullscreen'),
    })
    const workspace = createWorkspaceHost({
      ...common,
      replace: () => calls.push('workspace:replace'),
      pane: () => calls.push('workspace:pane'),
      window: () => calls.push('workspace:window'),
    })
    const canvas = createCanvasHost({
      ...common,
      window: (value) => {
        expect(value).not.toHaveProperty('x')
        expect(value).not.toHaveProperty('bounds')
        calls.push('canvas:window')
      },
    })

    library.open(plan('modal'))
    workspace.open(plan('pane'))
    canvas.open(plan('window'))
    canvas.focus('content-1')
    canvas.close('content-1')

    expect(calls).toEqual([
      'library:modal',
      'workspace:pane',
      'canvas:window',
      'focus:content-1',
      'close:content-1',
    ])
  })

  test('rejects a disposition not owned by the selected host', () => {
    const host = createCanvasHost({
      window: () => {},
      close: () => {},
      focus: () => {},
    })
    expect(() => host.open(plan('modal') as unknown as Parameters<typeof host.open>[0])).toThrow(
      'Canvas host cannot place modal content',
    )
  })
})
