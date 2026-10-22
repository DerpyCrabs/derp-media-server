import { apiSchemaEffect } from './client'
import { workspaceSettingsSchema, serverConfigSchema, viewStatsSchema } from './schemas'
import { groups, seedQuery } from './cache'
import { query } from '@effectweb/query'

export interface ServerConfig {
  writeAccess?: 'editableFolders' | 'filesystem'
  editableFolders: string[]
  mediaRoots: { id: string; name: string; editableFolders: string[] }[]
}
export interface ViewStats {
  views: Record<string, number>
}

export const settingsQuery = query({
  name: 'settings',
  groups: [groups.settings],
  staleTime: Infinity,
  load: () => apiSchemaEffect(workspaceSettingsSchema, '/api/settings'),
})
export const configQuery = query({
  name: 'server-config',
  groups: [groups.config],
  staleTime: Infinity,
  load: () => apiSchemaEffect(serverConfigSchema, '/api/config'),
})
export const statsQuery = query({
  name: 'stats',
  groups: [groups.stats],
  staleTime: Infinity,
  load: () => apiSchemaEffect(viewStatsSchema, '/api/stats/views'),
})
seedQuery(settingsQuery, true, ['settings'], workspaceSettingsSchema)
seedQuery(configQuery, true, ['server-config'], serverConfigSchema)
seedQuery(statsQuery, true, ['stats'], viewStatsSchema)
