import type { TaskbarPin } from '@/lib/models/taskbar-pins'

function pathHasDotDot(path: string): boolean {
  return path.split(/[/\\]/).some((segment) => segment === '..')
}

/** Pins accepted by the workspace's local filesystem boundary. */
export function filterAdminTaskbarPins(items: TaskbarPin[]): TaskbarPin[] {
  return items.filter(
    (pin) => pin.source.kind === 'local' && pin.path.length > 0 && !pathHasDotDot(pin.path),
  )
}
