import { resourceKey, type ResourceKey } from '@/lib/domain/resource'

export const HERMES_PROVIDER = 'hermes'
const HERMES_KEY_PREFIX = 'v1:'
const HERMES_OPAQUE_ID_MAX_BYTES = 512
const HERMES_CONTROL_CHARACTER = /\p{Cc}/u

export type HermesResourceKind = 'root' | 'archived' | 'project' | 'session'

export type HermesResourceAddress = Readonly<{
  kind: HermesResourceKind
  id?: string
}>

export function requireHermesOpaqueId(id: string): string {
  if (!id) throw new Error('Hermes resource id must not be empty')
  if (new TextEncoder().encode(id).byteLength > HERMES_OPAQUE_ID_MAX_BYTES) {
    throw new Error(`Hermes resource id must not exceed ${HERMES_OPAQUE_ID_MAX_BYTES} UTF-8 bytes`)
  }
  if (
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('%') ||
    HERMES_CONTROL_CHARACTER.test(id)
  ) {
    throw new Error('Hermes resource id contains a reserved character')
  }
  return id
}

export function hermesResourceKey(kind: HermesResourceKind, id?: string): ResourceKey {
  if ((kind === 'project' || kind === 'session') && id === undefined) {
    throw new Error(`Hermes ${kind} resource requires an id`)
  }
  if ((kind === 'root' || kind === 'archived') && id !== undefined) {
    throw new Error(`Hermes ${kind} resource does not accept an id`)
  }
  const opaque = id === undefined ? '' : requireHermesOpaqueId(id)
  return resourceKey(HERMES_PROVIDER, `${HERMES_KEY_PREFIX}${kind.length}:${kind}${opaque}`)
}

export function hermesResourceAddress(key: ResourceKey): HermesResourceAddress | null {
  if (key.provider !== HERMES_PROVIDER || !key.id.startsWith(HERMES_KEY_PREFIX)) return null
  const encoded = key.id.slice(HERMES_KEY_PREFIX.length)
  const separator = encoded.indexOf(':')
  if (separator <= 0) return null
  const kindLengthText = encoded.slice(0, separator)
  if (!/^\d+$/.test(kindLengthText)) return null
  const kindLength = Number(kindLengthText)
  const value = encoded.slice(separator + 1)
  if (!Number.isSafeInteger(kindLength) || kindLength <= 0 || kindLength > value.length) return null
  const kind = value.slice(0, kindLength)
  const id = value.slice(kindLength)
  if (!['root', 'archived', 'project', 'session'].includes(kind)) return null
  if ((kind === 'project' || kind === 'session') && !id) return null
  if ((kind === 'root' || kind === 'archived') && id) return null
  try {
    if (id) requireHermesOpaqueId(id)
  } catch {
    return null
  }
  return id ? { kind: kind as HermesResourceKind, id } : { kind: kind as HermesResourceKind }
}
