import { createSearchCoordinator } from '@/src/features/search/coordinator'
import type { ContentRegistry } from '@/src/features/content/registry'
import { applicationContentRegistry } from './registry'
import { serverIntegrationSearchContributor } from './http-client'

export function createApplicationSearchCoordinator(registry: ContentRegistry) {
  return createSearchCoordinator(() => [serverIntegrationSearchContributor, ...registry.searches()])
}

export const applicationSearchCoordinator = createApplicationSearchCoordinator(
  applicationContentRegistry,
)
