import { apiQueryRoots } from './generated/api-contracts'

export const queryKeys = {
  files: (path?: string) => {
    if (path === undefined) return [apiQueryRoots.files] as const
    return [apiQueryRoots.files, path] as const
  },
  filesPage: (path: string, surface?: 'library' | 'workspace' | 'canvas', offset = 0) => {
    if ((!surface || surface === 'library') && offset === 0) {
      return [apiQueryRoots.files, path] as const
    }
    return [apiQueryRoots.files, path, surface ?? 'library', offset] as const
  },
  settings: () => [apiQueryRoots.settings] as const,
  serverConfig: () => [apiQueryRoots.serverConfig] as const,
  stats: () => [apiQueryRoots.stats] as const,
  integrations: () => [apiQueryRoots.integrations] as const,
  applicationContent: () => [apiQueryRoots.content, 'application'] as const,
  textContent: (filePath: string) =>
    [apiQueryRoots.content, 'application', 'text', filePath] as const,
  audioMetadata: (filePath: string) => [apiQueryRoots.audioMetadata, 'v2', filePath] as const,
} as const
