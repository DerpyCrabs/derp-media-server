import { createContentRegistry } from '../features/content/registry'
import { createContentRuntime } from '../features/content/runtime'
import { filesystemIntegrationModule } from './filesystem/module'
import { hermesIntegrationModule } from './hermes/module'
import { integrationRoot, isIntegrationEnabled } from './availability'

export const integrationModules = Object.freeze([
  filesystemIntegrationModule,
  hermesIntegrationModule,
])

export const applicationContentRegistry = createContentRegistry(integrationModules, {
  enabled: isIntegrationEnabled,
  root: integrationRoot,
})
export const applicationContentRuntime = createContentRuntime(applicationContentRegistry)
