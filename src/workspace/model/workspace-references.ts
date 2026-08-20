import type { PersistedWorkspaceState } from './use-workspace'
import { workspaceValueEquals } from './workspace-equality'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function keyed(values: unknown[]) {
  return values.every(
    (value) =>
      value != null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as { id?: unknown }).id === 'string',
  )
}

function shareValue(current: unknown, next: unknown): unknown {
  if (workspaceValueEquals(current, next)) return current
  if (Array.isArray(current) && Array.isArray(next)) {
    if (keyed([...current, ...next])) {
      const currentById = new Map(
        current.map((item) => [(item as { id: string }).id, item] as const),
      )
      return next.map((item) => shareValue(currentById.get((item as { id: string }).id), item))
    }
    return clone(next)
  }
  if (
    current != null &&
    next != null &&
    typeof current === 'object' &&
    typeof next === 'object' &&
    !Array.isArray(current) &&
    !Array.isArray(next)
  ) {
    return Object.fromEntries(
      Object.entries(next).map(([key, value]) => [
        key,
        shareValue((current as Record<string, unknown>)[key], value),
      ]),
    )
  }
  return clone(next)
}

export function shareWorkspaceReferences(
  current: PersistedWorkspaceState,
  next: PersistedWorkspaceState,
): PersistedWorkspaceState {
  return shareValue(current, next) as PersistedWorkspaceState
}
