import type {
  IntegrationCapabilityDto,
  IntegrationDescriptorDto,
} from '@/lib/generated/api-contracts'
import { FILESYSTEM_PROVIDER, type ResourceSummary } from '@/lib/domain/resource'
import { resourceSummaryFromDto } from './http-client'

export function createIntegrationAvailability(initialIds: readonly string[] = []) {
  const enabled = new Set(initialIds)
  const descriptorById = new Map<string, IntegrationDescriptorDto>()
  const listeners = new Set<() => void>()
  let configured = false

  function isEnabled(id: string, capability?: IntegrationCapabilityDto): boolean {
    if (!enabled.has(id)) return false
    if (!configured || capability === undefined) return true
    return descriptorById.get(id)?.capabilities.includes(capability) ?? false
  }

  function root(id: string, staticRoot: ResourceSummary | undefined): ResourceSummary | null {
    if (!isEnabled(id, 'browse')) return null
    if (!configured) return staticRoot ?? null
    const value = descriptorById.get(id)?.root
    return value ? resourceSummaryFromDto(value) : null
  }

  function replace(nextDescriptors: readonly IntegrationDescriptorDto[]): void {
    const next = new Set(nextDescriptors.map((descriptor) => descriptor.id))
    const unchanged =
      configured &&
      next.size === enabled.size &&
      [...next].every((id) => enabled.has(id)) &&
      nextDescriptors.every(
        (descriptor) =>
          JSON.stringify(descriptor) === JSON.stringify(descriptorById.get(descriptor.id)),
      )
    if (unchanged) return
    configured = true
    enabled.clear()
    descriptorById.clear()
    for (const descriptor of nextDescriptors) descriptorById.set(descriptor.id, descriptor)
    for (const id of next) enabled.add(id)
    for (const listener of listeners) listener()
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return Object.freeze({ isEnabled, root, replace, subscribe })
}

const applicationAvailability = createIntegrationAvailability([FILESYSTEM_PROVIDER])

export const isIntegrationEnabled = applicationAvailability.isEnabled
export const integrationRoot = applicationAvailability.root
export const replaceEnabledIntegrations = applicationAvailability.replace
export const subscribeIntegrationAvailability = applicationAvailability.subscribe
