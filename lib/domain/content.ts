import { isResourceKey, type ResourceKey } from './resource'

export type ExplorerContentInstance = Readonly<{
  id: string
  type: 'explorer'
  location: ResourceKey
}>

export type ResourceContentInstance = Readonly<{
  id: string
  type: 'resource'
  resource: ResourceKey
  renderer: string
  context?: ResourceKey
}>

export type IntegrationContentInstance = Readonly<{
  id: string
  type: 'integration'
  integration: string
  view: string
  state: unknown
}>

export type ContentInstance =
  | ExplorerContentInstance
  | ResourceContentInstance
  | IntegrationContentInstance

export const CONTENT_ENVELOPE_SCHEMA_VERSION = 1 as const

export type PersistedContentEnvelope = Readonly<{
  schemaVersion: typeof CONTENT_ENVELOPE_SCHEMA_VERSION
  codec: string
  codecVersion: number
  payload: unknown
}>

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

export function isContentInstance(value: unknown): value is ContentInstance {
  const instance = record(value)
  if (!instance || typeof instance.id !== 'string' || !instance.id) return false
  if (instance.type === 'explorer') {
    return hasOnlyKeys(instance, ['id', 'type', 'location']) && isResourceKey(instance.location)
  }
  if (instance.type === 'resource') {
    return !!(
      hasOnlyKeys(instance, ['id', 'type', 'resource', 'renderer', 'context']) &&
      isResourceKey(instance.resource) &&
      typeof instance.renderer === 'string' &&
      instance.renderer &&
      (instance.context === undefined || isResourceKey(instance.context))
    )
  }
  if (instance.type === 'integration') {
    return !!(
      hasOnlyKeys(instance, ['id', 'type', 'integration', 'view', 'state']) &&
      typeof instance.integration === 'string' &&
      instance.integration &&
      typeof instance.view === 'string' &&
      instance.view &&
      Object.prototype.hasOwnProperty.call(instance, 'state')
    )
  }
  return false
}

export function isPersistedContentEnvelope(value: unknown): value is PersistedContentEnvelope {
  const envelope = record(value)
  return !!(
    envelope &&
    hasOnlyKeys(envelope, ['schemaVersion', 'codec', 'codecVersion', 'payload']) &&
    envelope.schemaVersion === CONTENT_ENVELOPE_SCHEMA_VERSION &&
    typeof envelope.codec === 'string' &&
    envelope.codec.trim() &&
    typeof envelope.codecVersion === 'number' &&
    Number.isSafeInteger(envelope.codecVersion) &&
    envelope.codecVersion > 0 &&
    Object.prototype.hasOwnProperty.call(envelope, 'payload')
  )
}
