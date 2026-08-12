import type { Space, SpaceCommand } from './space'

export function sameSpaceValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameSpaceValue(item, right[index]))
    )
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(rightRecord, key) && sameSpaceValue(leftRecord[key], rightRecord[key]),
    )
  )
}

/** Build minimal ordered commands that make durable content match desired presenter state. */
export function spaceCommandsToMatch(current: Space, desired: Space): SpaceCommand[] {
  if (current.id !== desired.id) throw new Error('Cannot reconcile different Spaces')
  if (current.origin !== desired.origin) throw new Error('Cannot change Space origin')
  const commands: SpaceCommand[] = []
  if (current.name !== desired.name) commands.push({ type: 'rename', name: desired.name })

  for (const paneId of Object.keys(current.panes)) {
    if (!Object.hasOwn(desired.panes, paneId)) commands.push({ type: 'removePane', paneId })
  }
  for (const [paneId, pane] of Object.entries(desired.panes)) {
    if (!Object.hasOwn(current.panes, paneId)) {
      commands.push({ type: 'addPane', paneId, pane })
      continue
    }
    const existing = current.panes[paneId]!
    if (existing.kind !== pane.kind) {
      commands.push({ type: 'removePane', paneId }, { type: 'addPane', paneId, pane })
    } else if (!sameSpaceValue(existing.state, pane.state)) {
      commands.push({ type: 'updatePane', paneId, pane })
    }
  }

  for (const arrangement of ['tiled', 'spatial'] as const) {
    const desiredValue = desired.arrangements[arrangement]
    if (!sameSpaceValue(current.arrangements[arrangement], desiredValue)) {
      commands.push({
        type: 'applyArrangement',
        presentation: arrangement,
        arrangement: desiredValue ?? null,
      })
    }
  }
  return commands
}

export function sameSpaceContent(left: Space, right: Space): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.origin === right.origin &&
    sameSpaceValue(left.panes, right.panes) &&
    sameSpaceValue(left.arrangements, right.arrangements) &&
    left.deletedAt === right.deletedAt
  )
}
