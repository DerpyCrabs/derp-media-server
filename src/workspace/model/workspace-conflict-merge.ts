import type { PersistedWorkspaceState } from './use-workspace'

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

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

function mergeValue(base: unknown, local: unknown, server: unknown): unknown {
  if (same(local, base)) return clone(server)
  if (same(server, base)) return clone(local)

  if (Array.isArray(local) && Array.isArray(server)) {
    const baseArray = Array.isArray(base) ? base : []
    if (keyed([...baseArray, ...local, ...server])) {
      const byId = (items: unknown[]) =>
        new Map(items.map((item) => [(item as { id: string }).id, item] as const))
      const baseItems = byId(baseArray)
      const localItems = byId(local)
      const serverItems = byId(server)
      const order = [
        ...local.map((item) => (item as { id: string }).id),
        ...server.map((item) => (item as { id: string }).id).filter((id) => !localItems.has(id)),
      ]
      return order.flatMap((id) => {
        const baseItem = baseItems.get(id)
        const localItem = localItems.get(id)
        const serverItem = serverItems.get(id)
        if (baseItem !== undefined && (localItem === undefined || serverItem === undefined))
          return []
        if (localItem === undefined) return serverItem === undefined ? [] : [clone(serverItem)]
        if (serverItem === undefined) return [clone(localItem)]
        return [mergeValue(baseItem, localItem, serverItem)]
      })
    }
    return clone(server)
  }

  if (
    local != null &&
    server != null &&
    typeof local === 'object' &&
    typeof server === 'object' &&
    !Array.isArray(local) &&
    !Array.isArray(server)
  ) {
    const baseObject = base != null && typeof base === 'object' && !Array.isArray(base) ? base : {}
    const localObject = local as Record<string, unknown>
    const serverObject = server as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of new Set([
      ...Object.keys(baseObject),
      ...Object.keys(localObject),
      ...Object.keys(serverObject),
    ])) {
      const merged = mergeValue(
        (baseObject as Record<string, unknown>)[key],
        localObject[key],
        serverObject[key],
      )
      if (merged !== undefined) result[key] = merged
    }
    return result
  }

  return clone(server)
}

export function mergeWorkspaceConflict(
  base: PersistedWorkspaceState,
  local: PersistedWorkspaceState,
  server: PersistedWorkspaceState,
): PersistedWorkspaceState {
  return mergeValue(base, local, server) as PersistedWorkspaceState
}

function shareValue(current: unknown, next: unknown): unknown {
  if (same(current, next)) return current
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
