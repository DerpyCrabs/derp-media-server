import {
  persistentWorkspaceWindows,
  type PersistedWorkspaceState,
  type WorkspaceWindowDefinition,
} from './use-workspace'
import { deletedHermesSessionIds } from './hermes-session-store'
import {
  CANVAS_SCHEMA_VERSION,
  createEmptyCanvasState,
  parseInfiniteCanvasState,
  type CanvasCamera,
  type CanvasWindowSize,
  type CanvasWindowSizeKey,
  type InfiniteCanvasState,
} from './infinite-canvas'

export const SPACE_SCHEMA_VERSION = 1 as const
export const DEFAULT_SPACE_NAME = 'Untitled space'

export type SpaceOrigin = 'canvas' | 'workspace'
export type SpacePaneKind = 'browser' | 'viewer' | 'assistant'
export type SpaceArrangementKind = 'tiled' | 'spatial'

export type SpacePane = {
  kind: SpacePaneKind
  state: Record<string, unknown>
}

export type SpatialSpaceArrangement = {
  placements: Record<
    string,
    {
      bounds: { x: number; y: number; width: number; height: number }
      zIndex: number
    }
  >
}

export type TiledSpaceArrangement = {
  placements: Record<string, { layout: Record<string, unknown> }>
  paneOrder?: string[]
  tabGroups?: Record<string, string[]>
  splits?: Record<string, { leftPaneId: string; leftPaneFraction: number }>
}

export type Space = {
  schemaVersion: typeof SPACE_SCHEMA_VERSION
  id: string
  name: string
  revision: number
  origin: SpaceOrigin
  panes: Record<string, SpacePane>
  arrangements: {
    tiled?: Record<string, unknown>
    spatial?: Record<string, unknown>
  }
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type SpaceSummary = Pick<
  Space,
  'id' | 'name' | 'revision' | 'origin' | 'createdAt' | 'updatedAt' | 'deletedAt'
> & { paneCount: number }

export type CreateSpaceCommand = {
  type: 'create'
  id?: string
  name: string
  origin: SpaceOrigin
  panes?: Record<string, SpacePane>
  arrangements?: Space['arrangements']
}

export type SpaceCommand =
  | CreateSpaceCommand
  | { type: 'rename'; name: string }
  | { type: 'delete' }
  | { type: 'duplicate'; sourceRevision?: number; newId?: string; name?: string }
  | { type: 'addPane'; paneId: string; pane: SpacePane }
  | { type: 'removePane'; paneId: string }
  | { type: 'updatePane'; paneId: string; pane: SpacePane }
  | {
      type: 'applyArrangement'
      presentation: SpaceArrangementKind
      arrangement: Record<string, unknown> | null
    }
  | { type: 'restoreRevision'; revision: number }

export type SpaceValidationIssue = {
  path: string
  message: string
}

export type SpaceParseResult =
  | { ok: true; space: Space }
  | { ok: false; issues: SpaceValidationIssue[] }

export type SpaceCommandResult =
  | { ok: true; space: Space }
  | { ok: false; code: 'invalid' | 'notFound' | 'alreadyExists' | 'deleted'; message: string }

export type CanvasSpaceSessionState = {
  camera: CanvasCamera
  maximizedWindowId: string | null
  windowSizeByType: Partial<Record<CanvasWindowSizeKey, CanvasWindowSize>>
  selectedPaneIds?: string[]
}

export type WorkspaceSpaceSessionState = Pick<
  PersistedWorkspaceState,
  'activeWindowId' | 'activeTabMap' | 'nextWindowId' | 'pinnedTaskbarItems'
> & {
  browserTabTitle?: string
  browserTabIcon?: string
  browserTabIconColor?: string
  fileOpenTarget?: PersistedWorkspaceState['fileOpenTarget']
}

type Clock = { now(): number }

const timestampNow = (clock: Clock = Date) => Math.max(0, Math.floor(clock.now()))

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return normalizeJsonRecord(value, 'value')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validateJsonValue(
  value: unknown,
  path: string,
  issues: SpaceValidationIssue[],
  ancestors: Set<object>,
): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return true
    issues.push({ path, message: 'must be a finite JSON number' })
    return false
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      issues.push({ path, message: 'must not contain cycles' })
      return false
    }
    ancestors.add(value)
    const valid = value.reduce(
      (result, item, index) =>
        validateJsonValue(item, `${path}.${index}`, issues, ancestors) && result,
      true,
    )
    ancestors.delete(value)
    return valid
  }
  if (!isPlainRecord(value)) {
    issues.push({ path, message: 'must contain only JSON values' })
    return false
  }
  if (ancestors.has(value)) {
    issues.push({ path, message: 'must not contain cycles' })
    return false
  }
  ancestors.add(value)
  const valid = Object.entries(value).reduce(
    (result, [key, item]) => validateJsonValue(item, `${path}.${key}`, issues, ancestors) && result,
    true,
  )
  ancestors.delete(value)
  return valid
}

function cloneJsonRecord(
  value: Record<string, unknown>,
  path: string,
  issues: SpaceValidationIssue[],
): Record<string, unknown> | null {
  return validateJsonValue(value, path, issues, new Set()) ? cloneRecord(value) : null
}

const OMIT_JSON_PROPERTY = Symbol('omit-json-property')

function normalizeJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): unknown | typeof OMIT_JSON_PROPERTY {
  if (value === undefined) return OMIT_JSON_PROPERTY
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    throw new Error(`${path} must be a finite JSON number`)
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error(`${path} must not contain cycles`)
    ancestors.add(value)
    const normalized = value.map((item, index) => {
      const result = normalizeJsonValue(item, `${path}.${index}`, ancestors)
      if (result === OMIT_JSON_PROPERTY) throw new Error(`${path}.${index} must be a JSON value`)
      return result
    })
    ancestors.delete(value)
    return normalized
  }
  if (!isPlainRecord(value)) throw new Error(`${path} must contain only JSON values`)
  if (ancestors.has(value)) throw new Error(`${path} must not contain cycles`)
  ancestors.add(value)
  const entries: [string, unknown][] = []
  for (const [key, item] of Object.entries(value)) {
    const normalized = normalizeJsonValue(item, `${path}.${key}`, ancestors)
    if (normalized !== OMIT_JSON_PROPERTY) entries.push([key, normalized])
  }
  ancestors.delete(value)
  return Object.fromEntries(entries)
}

function normalizeJsonRecord(value: Record<string, unknown>, path: string) {
  const normalized = normalizeJsonValue(value, path, new Set())
  if (!isRecord(normalized)) throw new Error(`${path} must be an object`)
  return normalized
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 120
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function parsePane(value: unknown, path: string, issues: SpaceValidationIssue[]): SpacePane | null {
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object' })
    return null
  }
  if (value.kind !== 'browser' && value.kind !== 'viewer' && value.kind !== 'assistant') {
    issues.push({ path: `${path}.kind`, message: 'must be browser, viewer, or assistant' })
    return null
  }
  if (!isRecord(value.state)) {
    issues.push({ path: `${path}.state`, message: 'must be an object' })
    return null
  }
  const state = cloneJsonRecord(value.state, `${path}.state`, issues)
  if (
    state &&
    new TextEncoder().encode(JSON.stringify({ kind: value.kind, state })).length > 256 * 1024
  ) {
    issues.push({ path, message: 'must not exceed 256 KB' })
    return null
  }
  return state ? { kind: value.kind, state } : null
}

function validateArrangementShape(
  kind: SpaceArrangementKind,
  value: Record<string, unknown>,
  path: string,
  issues: SpaceValidationIssue[],
) {
  if (kind === 'spatial' && !isRecord(value.placements)) {
    issues.push({ path: `${path}.placements`, message: 'must be an object' })
    return
  }
  if (!isRecord(value.placements)) return
  for (const [paneId, rawPlacement] of Object.entries(value.placements)) {
    const placementPath = `${path}.placements.${paneId}`
    if (!isRecord(rawPlacement)) {
      issues.push({ path: placementPath, message: 'must be an object' })
      continue
    }
    if (kind === 'tiled') continue
    if (!isRecord(rawPlacement.bounds)) {
      issues.push({ path: `${placementPath}.bounds`, message: 'must be an object' })
      continue
    }
    const { x, y, width, height } = rawPlacement.bounds
    if (
      ![x, y, width, height].every(
        (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate),
      ) ||
      Number(width) <= 0 ||
      Number(height) <= 0
    ) {
      issues.push({
        path: `${placementPath}.bounds`,
        message: 'must contain finite positive bounds',
      })
    }
    if (!Number.isSafeInteger(rawPlacement.zIndex) || Number(rawPlacement.zIndex) < 0) {
      issues.push({ path: `${placementPath}.zIndex`, message: 'must be a non-negative integer' })
    }
  }
}

function collectArrangementPaneReferences(
  value: unknown,
  paneIds: ReadonlySet<string>,
  path: string,
  issues: SpaceValidationIssue[],
) {
  if (!isRecord(value)) return
  const placements = value.placements
  if (placements !== undefined) {
    if (!isRecord(placements)) {
      issues.push({ path: `${path}.placements`, message: 'must be an object' })
    } else {
      for (const paneId of Object.keys(placements)) {
        if (!paneIds.has(paneId)) {
          issues.push({ path: `${path}.placements.${paneId}`, message: 'references missing pane' })
        }
      }
    }
  }
  const paneId = value.paneId
  if (typeof paneId === 'string' && !paneIds.has(paneId)) {
    issues.push({ path: `${path}.paneId`, message: 'references missing pane' })
  }
  const paneIdsValue = value.paneIds
  if (Array.isArray(paneIdsValue)) {
    paneIdsValue.forEach((id, index) => {
      if (typeof id !== 'string' || !paneIds.has(id)) {
        issues.push({ path: `${path}.paneIds.${index}`, message: 'references missing pane' })
      }
    })
  }
  const paneOrder = value.paneOrder
  if (Array.isArray(paneOrder)) {
    paneOrder.forEach((id, index) => {
      if (typeof id !== 'string' || !paneIds.has(id)) {
        issues.push({ path: `${path}.paneOrder.${index}`, message: 'references missing pane' })
      }
    })
  } else if (paneOrder !== undefined) {
    issues.push({ path: `${path}.paneOrder`, message: 'must be an array' })
  }
  const tabGroups = value.tabGroups
  if (tabGroups !== undefined) {
    if (!isRecord(tabGroups)) {
      issues.push({ path: `${path}.tabGroups`, message: 'must be an object' })
    } else {
      for (const [groupId, members] of Object.entries(tabGroups)) {
        if (!Array.isArray(members)) {
          issues.push({ path: `${path}.tabGroups.${groupId}`, message: 'must be an array' })
          continue
        }
        members.forEach((id, index) => {
          if (typeof id !== 'string' || !paneIds.has(id)) {
            issues.push({
              path: `${path}.tabGroups.${groupId}.${index}`,
              message: 'references missing pane',
            })
          }
        })
      }
    }
  }
  const splits = value.splits
  if (splits !== undefined) {
    if (!isRecord(splits)) {
      issues.push({ path: `${path}.splits`, message: 'must be an object' })
    } else {
      for (const [groupId, split] of Object.entries(splits)) {
        if (!isRecord(split) || typeof split.leftPaneId !== 'string') {
          issues.push({ path: `${path}.splits.${groupId}`, message: 'must name a leftPaneId' })
        } else if (!paneIds.has(split.leftPaneId)) {
          issues.push({
            path: `${path}.splits.${groupId}.leftPaneId`,
            message: 'references missing pane',
          })
        }
      }
    }
  }
}

export function parseSpace(value: unknown): SpaceParseResult {
  const issues: SpaceValidationIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '$', message: 'must be an object' }] }
  if (value.schemaVersion !== SPACE_SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', message: `must equal ${SPACE_SCHEMA_VERSION}` })
  }
  if (!validId(value.id)) issues.push({ path: 'id', message: 'must be a safe non-empty ID' })
  if (!validName(value.name)) issues.push({ path: 'name', message: 'must be 1-120 characters' })
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    issues.push({ path: 'revision', message: 'must be a non-negative safe integer' })
  }
  if (value.origin !== 'canvas' && value.origin !== 'workspace') {
    issues.push({ path: 'origin', message: 'must be canvas or workspace' })
  }
  if (!validTimestamp(value.createdAt)) {
    issues.push({ path: 'createdAt', message: 'must be a non-negative integer timestamp' })
  }
  if (!validTimestamp(value.updatedAt)) {
    issues.push({ path: 'updatedAt', message: 'must be a non-negative integer timestamp' })
  }
  if (value.deletedAt !== undefined && !validTimestamp(value.deletedAt)) {
    issues.push({ path: 'deletedAt', message: 'must be a non-negative integer timestamp' })
  }

  const paneEntries: [string, SpacePane][] = []
  if (!isRecord(value.panes)) {
    issues.push({ path: 'panes', message: 'must be an object' })
  } else {
    if (Object.keys(value.panes).length > 256) {
      issues.push({ path: 'panes', message: 'must not contain more than 256 panes' })
    }
    for (const [paneId, rawPane] of Object.entries(value.panes)) {
      if (!validId(paneId)) {
        issues.push({ path: `panes.${paneId}`, message: 'pane ID is invalid' })
        continue
      }
      const pane = parsePane(rawPane, `panes.${paneId}`, issues)
      if (pane) paneEntries.push([paneId, pane])
    }
  }
  const panes = Object.fromEntries(paneEntries)

  const arrangements: Space['arrangements'] = {}
  if (!isRecord(value.arrangements)) {
    issues.push({ path: 'arrangements', message: 'must be an object' })
  } else {
    const paneIds = new Set(Object.keys(panes))
    for (const kind of ['tiled', 'spatial'] as const) {
      const raw = value.arrangements[kind]
      if (raw === undefined) continue
      if (!isRecord(raw)) {
        issues.push({ path: `arrangements.${kind}`, message: 'must be an object' })
        continue
      }
      const arrangement = cloneJsonRecord(raw, `arrangements.${kind}`, issues)
      if (!arrangement) continue
      arrangements[kind] = arrangement
      validateArrangementShape(kind, arrangement, `arrangements.${kind}`, issues)
      collectArrangementPaneReferences(arrangement, paneIds, `arrangements.${kind}`, issues)
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    space: {
      schemaVersion: SPACE_SCHEMA_VERSION,
      id: value.id as string,
      name: (value.name as string).trim(),
      revision: value.revision as number,
      origin: value.origin as SpaceOrigin,
      panes,
      arrangements,
      createdAt: value.createdAt as number,
      updatedAt: value.updatedAt as number,
      ...(value.deletedAt !== undefined ? { deletedAt: value.deletedAt as number } : {}),
    },
  }
}

export function parseSpaceOrThrow(value: unknown): Space {
  const result = parseSpace(value)
  if (result.ok) return result.space
  throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
}

export function parseSpaceSummary(value: unknown): SpaceSummary | null {
  if (!isRecord(value)) return null
  if (
    !validId(value.id) ||
    !validName(value.name) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    (value.origin !== 'canvas' && value.origin !== 'workspace') ||
    !validTimestamp(value.createdAt) ||
    !validTimestamp(value.updatedAt) ||
    (value.deletedAt !== undefined && !validTimestamp(value.deletedAt)) ||
    !Number.isSafeInteger(value.paneCount) ||
    Number(value.paneCount) < 0
  ) {
    return null
  }
  return {
    id: value.id,
    name: value.name.trim(),
    revision: value.revision,
    origin: value.origin,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.deletedAt !== undefined ? { deletedAt: value.deletedAt } : {}),
    paneCount: value.paneCount,
  } as SpaceSummary
}

function commandFailure(
  code: Extract<SpaceCommandResult, { ok: false }>['code'],
  message: string,
): SpaceCommandResult {
  return { ok: false, code, message }
}

function pruneArrangementPane(value: Record<string, unknown>, paneId: string) {
  const next = cloneRecord(value)
  if (isRecord(next.placements)) delete next.placements[paneId]
  if (Array.isArray(next.paneIds)) next.paneIds = next.paneIds.filter((id) => id !== paneId)
  if (Array.isArray(next.paneOrder)) next.paneOrder = next.paneOrder.filter((id) => id !== paneId)
  if (next.paneId === paneId) delete next.paneId
  if (isRecord(next.tabGroups)) {
    for (const [groupId, members] of Object.entries(next.tabGroups)) {
      if (!Array.isArray(members)) continue
      const remaining = members.filter((id) => id !== paneId)
      if (remaining.length > 0) next.tabGroups[groupId] = remaining
      else delete next.tabGroups[groupId]
    }
  }
  if (isRecord(next.splits)) {
    for (const [groupId, split] of Object.entries(next.splits)) {
      if (isRecord(split) && split.leftPaneId === paneId) delete next.splits[groupId]
    }
  }
  return next
}

export function reduceSpaceCommand(
  current: Space | null,
  command: SpaceCommand,
  clock: Clock = Date,
): SpaceCommandResult {
  const now = timestampNow(clock)
  if (command.type === 'create') {
    if (current) return commandFailure('alreadyExists', 'Space already exists')
    if (!validId(command.id) || !validName(command.name)) {
      return commandFailure('invalid', 'Space ID or name is invalid')
    }
    const candidate = {
      schemaVersion: SPACE_SCHEMA_VERSION,
      id: command.id,
      name: command.name.trim(),
      revision: 0,
      origin: command.origin,
      panes: structuredClone(command.panes ?? {}),
      arrangements: structuredClone(command.arrangements ?? {}),
      createdAt: now,
      updatedAt: now,
    }
    const parsed = parseSpace(candidate)
    return parsed.ok
      ? parsed
      : commandFailure('invalid', parsed.issues[0]?.message ?? 'Invalid Space')
  }
  if (!current) return commandFailure('notFound', 'Space does not exist')
  if (
    current.deletedAt !== undefined &&
    command.type !== 'duplicate' &&
    command.type !== 'restoreRevision'
  ) {
    return commandFailure('deleted', 'Space is deleted')
  }

  let next: Space
  switch (command.type) {
    case 'rename':
      if (!validName(command.name)) return commandFailure('invalid', 'Space name is invalid')
      next = { ...current, name: command.name.trim() }
      break
    case 'delete':
      if (current.deletedAt !== undefined) return commandFailure('deleted', 'Space is deleted')
      next = { ...current, deletedAt: now }
      break
    case 'duplicate':
      if (
        !validId(command.newId) ||
        !validName(command.name ?? `${current.name} copy`) ||
        current.deletedAt !== undefined ||
        (command.sourceRevision !== undefined &&
          (!Number.isSafeInteger(command.sourceRevision) || command.sourceRevision < 0))
      ) {
        return commandFailure('invalid', 'Recovered Space ID or name is invalid')
      }
      if (command.sourceRevision !== undefined && command.sourceRevision !== current.revision) {
        return commandFailure('invalid', 'duplicate requires retained server snapshot')
      }
      next = {
        ...structuredClone(current),
        id: command.newId,
        name: (command.name ?? `${current.name} copy`).trim(),
        revision: 0,
        createdAt: now,
        updatedAt: now,
      }
      delete next.deletedAt
      return { ok: true, space: next }
    case 'addPane':
      if (!validId(command.paneId) || Object.hasOwn(current.panes, command.paneId)) {
        return commandFailure('alreadyExists', 'Pane already exists or ID is invalid')
      }
      {
        const parsed = parsePane(command.pane, `panes.${command.paneId}`, [])
        if (!parsed) return commandFailure('invalid', 'Pane is invalid')
        next = { ...current, panes: { ...current.panes, [command.paneId]: parsed } }
      }
      break
    case 'removePane':
      if (!Object.hasOwn(current.panes, command.paneId)) {
        return commandFailure('notFound', 'Pane does not exist')
      }
      {
        const panes = { ...current.panes }
        delete panes[command.paneId]
        const arrangements = Object.fromEntries(
          Object.entries(current.arrangements).map(([kind, value]) => [
            kind,
            value ? pruneArrangementPane(value, command.paneId) : value,
          ]),
        ) as Space['arrangements']
        next = { ...current, panes, arrangements }
      }
      break
    case 'updatePane':
      if (!Object.hasOwn(current.panes, command.paneId)) {
        return commandFailure('notFound', 'Pane does not exist')
      }
      {
        const replacement = parsePane(command.pane, `panes.${command.paneId}`, [])
        if (!replacement) return commandFailure('invalid', 'Pane is invalid')
        next = {
          ...current,
          panes: { ...current.panes, [command.paneId]: replacement },
        }
      }
      break
    case 'applyArrangement':
      if (command.arrangement !== null && !isRecord(command.arrangement)) {
        return commandFailure('invalid', 'Arrangement must be an object or null')
      }
      {
        const arrangements = { ...current.arrangements }
        if (command.arrangement === null) delete arrangements[command.presentation]
        else arrangements[command.presentation] = cloneRecord(command.arrangement)
        next = { ...current, arrangements }
      }
      break
    case 'restoreRevision':
      return commandFailure('invalid', 'restoreRevision requires retained server snapshot')
  }
  const candidate = { ...next, revision: current.revision + 1, updatedAt: now }
  const parsed = parseSpace(candidate)
  return parsed.ok
    ? parsed
    : commandFailure('invalid', parsed.issues[0]?.message ?? 'Invalid Space')
}

function paneKind(type: WorkspaceWindowDefinition['type']): SpacePaneKind {
  return type === 'hermes' ? 'assistant' : type
}

function paneType(kind: SpacePaneKind): WorkspaceWindowDefinition['type'] {
  return kind === 'assistant' ? 'hermes' : kind
}

function definitionToPane(
  definition: WorkspaceWindowDefinition,
  preserveTabGroupId = false,
): SpacePane {
  const { id: _id, type: _type, layout: _layout, ...state } = structuredClone(definition)
  if (!preserveTabGroupId) delete state.tabGroupId
  return {
    kind: paneKind(definition.type),
    state: normalizeJsonRecord(state as Record<string, unknown>, `panes.${definition.id}.state`),
  }
}

function assertUniquePaneIds(windows: readonly { id: string }[]) {
  const seen = new Set<string>()
  for (const window of windows) {
    if (!validId(window.id)) throw new Error('Pane ID is invalid')
    if (seen.has(window.id)) throw new Error(`Duplicate pane ID: ${window.id}`)
    seen.add(window.id)
  }
}

function paneToDefinition(
  paneId: string,
  pane: SpacePane,
  layout?: Record<string, unknown>,
  tabGroupId?: string | null,
): WorkspaceWindowDefinition {
  return {
    ...(cloneRecord(pane.state) as Omit<WorkspaceWindowDefinition, 'id' | 'type'>),
    id: paneId,
    type: paneType(pane.kind),
    ...(layout ? { layout: structuredClone(layout) } : {}),
    ...(tabGroupId !== undefined ? { tabGroupId } : {}),
  } as WorkspaceWindowDefinition
}

export function canvasStateToSpace(
  input: {
    id: string
    name: string
    state: InfiniteCanvasState
    revision?: number
    createdAt?: number
    updatedAt?: number
  },
  clock: Clock = Date,
): Space {
  const durableWindows = input.state.windows
    .filter(
      (window) =>
        window.definition.type !== 'hermes' ||
        (!!window.definition.hermes?.sessionId &&
          !deletedHermesSessionIds.has(window.definition.hermes.sessionId)),
    )
    .map((window) => {
      const copy = structuredClone(window)
      if (copy.definition.type !== 'hermes') return copy
      const { draftId: _draftId, ...hermes } = copy.definition.hermes ?? {}
      return { ...copy, definition: { ...copy.definition, hermes } }
    })
  const validated = parseInfiniteCanvasState({ ...input.state, windows: durableWindows })
  if (!validated || validated.windows.length !== durableWindows.length) {
    throw new Error('Canvas state is invalid')
  }
  assertUniquePaneIds(durableWindows)
  const now = timestampNow(clock)
  const panes = Object.fromEntries(
    durableWindows.map((window) => [window.id, definitionToPane(window.definition, true)]),
  )
  const spatial: SpatialSpaceArrangement = {
    placements: Object.fromEntries(
      durableWindows.map((window) => [
        window.id,
        { bounds: structuredClone(window.bounds), zIndex: window.zIndex },
      ]),
    ),
  }
  return parseSpaceOrThrow({
    schemaVersion: SPACE_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    revision: input.revision ?? 0,
    origin: 'canvas',
    panes,
    arrangements: { spatial },
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  })
}

export function projectSpaceToCanvas(
  space: Space,
  session: Partial<CanvasSpaceSessionState> = {},
): InfiniteCanvasState {
  const parsed = parseSpaceOrThrow(space)
  const rawSpatial = parsed.arrangements.spatial
  const spatial =
    isRecord(rawSpatial) && isRecord(rawSpatial.placements) ? rawSpatial.placements : {}
  const windows = Object.entries(parsed.panes).map(([paneId, pane], index) => {
    const placement = spatial[paneId]
    const rawBounds = isRecord(placement) && isRecord(placement.bounds) ? placement.bounds : null
    const validBounds =
      !!rawBounds &&
      ['x', 'y', 'width', 'height'].every(
        (key) => typeof rawBounds[key] === 'number' && Number.isFinite(rawBounds[key]),
      ) &&
      Number(rawBounds.width) > 0 &&
      Number(rawBounds.height) > 0
    const bounds = validBounds
      ? {
          x: Number(rawBounds.x),
          y: Number(rawBounds.y),
          width: Number(rawBounds.width),
          height: Number(rawBounds.height),
        }
      : { x: index * 32, y: index * 32, width: 640, height: 480 }
    return {
      id: paneId,
      definition: paneToDefinition(paneId, pane),
      bounds,
      zIndex:
        isRecord(placement) &&
        typeof placement.zIndex === 'number' &&
        Number.isFinite(placement.zIndex)
          ? Math.max(1, Math.floor(placement.zIndex))
          : index + 1,
    }
  })
  const empty = createEmptyCanvasState()
  const maxWindowNumber = Math.max(
    0,
    ...windows.map((window) => Number(/^canvas-window-(\d+)$/.exec(window.id)?.[1] ?? 0)),
  )
  const maxZIndex = Math.max(0, ...windows.map((window) => window.zIndex))
  return {
    version: CANVAS_SCHEMA_VERSION,
    windows,
    maximizedWindowId:
      session.maximizedWindowId && windows.some((window) => window.id === session.maximizedWindowId)
        ? session.maximizedWindowId
        : null,
    camera: structuredClone(session.camera ?? empty.camera),
    windowSizeByType: structuredClone(session.windowSizeByType ?? {}),
    nextItemId: maxWindowNumber + 1,
    nextZIndex: maxZIndex + 1,
  }
}

export function workspaceStateToSpace(
  input: {
    id: string
    name: string
    state: PersistedWorkspaceState
    revision?: number
    createdAt?: number
    updatedAt?: number
  },
  clock: Clock = Date,
): Space {
  const now = timestampNow(clock)
  const windows = persistentWorkspaceWindows(input.state.windows)
  assertUniquePaneIds(windows)
  const panes = Object.fromEntries(windows.map((window) => [window.id, definitionToPane(window)]))
  const tabGroups: Record<string, string[]> = {}
  for (const window of windows) {
    const groupId = window.tabGroupId ?? window.id
    ;(tabGroups[groupId] ??= []).push(window.id)
  }
  const placements = Object.fromEntries(
    windows.map((window) => [
      window.id,
      {
        layout: normalizeJsonRecord(
          (window.layout ?? {}) as Record<string, unknown>,
          `arrangements.tiled.placements.${window.id}.layout`,
        ),
      },
    ]),
  )
  const splits = Object.fromEntries(
    Object.entries(input.state.tabGroupSplits ?? {}).flatMap(([groupId, split]) =>
      panes[split.leftTabId]
        ? [[groupId, { leftPaneId: split.leftTabId, leftPaneFraction: split.leftPaneFraction }]]
        : [],
    ),
  )
  const tiled: TiledSpaceArrangement = {
    placements,
    paneOrder: windows.map((window) => window.id),
    tabGroups,
    ...(Object.keys(splits).length > 0 ? { splits } : {}),
  }
  return parseSpaceOrThrow({
    schemaVersion: SPACE_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    revision: input.revision ?? 0,
    origin: 'workspace',
    panes,
    arrangements: { tiled },
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  })
}

export function projectSpaceToWorkspace(
  space: Space,
  session: Partial<WorkspaceSpaceSessionState> = {},
): PersistedWorkspaceState {
  const parsed = parseSpaceOrThrow(space)
  const rawTiled = parsed.arrangements.tiled
  const tiled = isRecord(rawTiled) ? rawTiled : {}
  const placements = isRecord(tiled.placements) ? tiled.placements : {}
  const tabGroups = isRecord(tiled.tabGroups) ? tiled.tabGroups : {}
  const groupByPane = new Map<string, string>()
  for (const [groupId, members] of Object.entries(tabGroups)) {
    if (!Array.isArray(members)) continue
    for (const paneId of members) if (typeof paneId === 'string') groupByPane.set(paneId, groupId)
  }
  const orderedPaneIds = [
    ...(Array.isArray(tiled.paneOrder)
      ? tiled.paneOrder.filter(
          (paneId): paneId is string =>
            typeof paneId === 'string' && Object.hasOwn(parsed.panes, paneId),
        )
      : []),
    ...Object.keys(parsed.panes).filter(
      (paneId) => !Array.isArray(tiled.paneOrder) || !tiled.paneOrder.includes(paneId),
    ),
  ]
  const windows = orderedPaneIds.map((paneId) => {
    const pane = parsed.panes[paneId]!
    const placement = placements[paneId]
    const layout = isRecord(placement) && isRecord(placement.layout) ? placement.layout : undefined
    const groupId = groupByPane.get(paneId)
    return paneToDefinition(paneId, pane, layout, groupId === paneId ? null : (groupId ?? null))
  })
  const windowIds = new Set(windows.map((window) => window.id))
  const activeWindowId =
    session.activeWindowId && windowIds.has(session.activeWindowId) ? session.activeWindowId : null
  const activeTabMap = Object.fromEntries(
    Object.entries(session.activeTabMap ?? {}).filter(([, paneId]) => windowIds.has(paneId)),
  )
  const tabGroupSplits = isRecord(tiled.splits)
    ? Object.fromEntries(
        Object.entries(tiled.splits).flatMap(([groupId, split]) => {
          if (
            !isRecord(split) ||
            typeof split.leftPaneId !== 'string' ||
            !windowIds.has(split.leftPaneId) ||
            typeof split.leftPaneFraction !== 'number'
          ) {
            return []
          }
          return [
            [groupId, { leftTabId: split.leftPaneId, leftPaneFraction: split.leftPaneFraction }],
          ]
        }),
      )
    : undefined
  const maxWindowNumber = Math.max(
    0,
    ...windows.map((window) => Number(/^workspace-window-(\d+)$/.exec(window.id)?.[1] ?? 0)),
  )
  return {
    windows,
    activeWindowId,
    activeTabMap,
    nextWindowId: Math.max(session.nextWindowId ?? 1, maxWindowNumber + 1),
    pinnedTaskbarItems: structuredClone(session.pinnedTaskbarItems ?? []),
    ...(tabGroupSplits && Object.keys(tabGroupSplits).length > 0 ? { tabGroupSplits } : {}),
    ...(session.browserTabTitle ? { browserTabTitle: session.browserTabTitle } : {}),
    ...(session.browserTabIcon ? { browserTabIcon: session.browserTabIcon } : {}),
    ...(session.browserTabIconColor ? { browserTabIconColor: session.browserTabIconColor } : {}),
    ...(session.fileOpenTarget ? { fileOpenTarget: session.fileOpenTarget } : {}),
  }
}

export function canvasSessionState(state: InfiniteCanvasState): CanvasSpaceSessionState {
  return {
    camera: structuredClone(state.camera),
    maximizedWindowId: state.maximizedWindowId,
    windowSizeByType: structuredClone(state.windowSizeByType),
  }
}

export function workspaceSessionState(state: PersistedWorkspaceState): WorkspaceSpaceSessionState {
  return {
    activeWindowId: state.activeWindowId,
    activeTabMap: structuredClone(state.activeTabMap),
    nextWindowId: state.nextWindowId,
    pinnedTaskbarItems: structuredClone(state.pinnedTaskbarItems),
    ...(state.browserTabTitle ? { browserTabTitle: state.browserTabTitle } : {}),
    ...(state.browserTabIcon ? { browserTabIcon: state.browserTabIcon } : {}),
    ...(state.browserTabIconColor ? { browserTabIconColor: state.browserTabIconColor } : {}),
    ...(state.fileOpenTarget ? { fileOpenTarget: state.fileOpenTarget } : {}),
  }
}
