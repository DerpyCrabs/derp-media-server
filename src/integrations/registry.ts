import { createContentRegistry } from '../features/content/registry'
import { createContentRuntime } from '../features/content/runtime'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import type { ResourceSummary } from '@/lib/domain/resource'
import type { VirtualEntryDto } from '@/lib/generated/api-contracts'
import type { FileItem } from '@/lib/types'
import {
  createFilesystemIntegrationModule,
  defaultFilesystemIntegrationTransport,
  legacyFilesystemResourceKey,
} from './filesystem/module'
import type { ContentInstance } from '@/lib/domain/content'
import {
  HERMES_PROVIDER,
  adaptHermesLegacyEntryResource,
  hermesIntegrationModule,
  type HermesContentState,
} from './hermes/module'

function adaptApplicationVirtualEntry(
  file: FileItem,
  entry: VirtualEntryDto | undefined,
): ResourceSummary | null {
  const hermes = adaptHermesLegacyEntryResource(file, entry)
  if (hermes) return hermes
  if (
    !Object.values(VIRTUAL_FOLDERS).includes(
      file.path as (typeof VIRTUAL_FOLDERS)[keyof typeof VIRTUAL_FOLDERS],
    )
  ) {
    return null
  }
  return {
    key: legacyFilesystemResourceKey(file.path),
    name: file.name,
    kind: 'collection',
    capabilities: ['browse'],
    presentation: 'browse',
    metadata: { fileType: file.type, extension: '', isDirectory: true },
  }
}

const filesystemIntegrationModule = createFilesystemIntegrationModule(
  defaultFilesystemIntegrationTransport,
  { adaptVirtual: adaptApplicationVirtualEntry },
)

export const integrationModules = Object.freeze([
  filesystemIntegrationModule,
  hermesIntegrationModule,
])

export const applicationContentRegistry = createContentRegistry(integrationModules)
export const applicationContentRuntime = createContentRuntime(applicationContentRegistry)

export function createApplicationAssistantDraftContent(id: string): ContentInstance {
  return {
    id,
    type: 'integration',
    integration: HERMES_PROVIDER,
    view: 'chat',
    state: {
      draftId: crypto.randomUUID(),
      readOnly: false,
    } satisfies HermesContentState,
  }
}
