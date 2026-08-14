import { describe, expect, test } from 'bun:test'
import { createSurfaceLifecycleCoordinator } from '@/src/features/content/surface-lifecycle'

describe('surface lifecycle coordinator', () => {
  test('blocks navigation until registered surface accepts leave', async () => {
    const coordinator = createSurfaceLifecycleCoordinator()
    let allow = false
    const unregister = coordinator.register('workspace', {
      leave: async () => allow,
    })

    expect(await coordinator.leave('workspace')).toBe(false)
    allow = true
    expect(await coordinator.leave('workspace')).toBe(true)
    unregister()
    expect(await coordinator.leave('workspace')).toBe(true)
  })

  test('forwards page teardown to active surface', () => {
    const coordinator = createSurfaceLifecycleCoordinator()
    coordinator.register('canvas', {
      leave: async () => true,
      beforeUnload(event) {
        event.preventDefault()
        event.returnValue = ''
      },
    })
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent

    coordinator.beforeUnload(event)

    expect(event.defaultPrevented).toBe(true)
  })
})
