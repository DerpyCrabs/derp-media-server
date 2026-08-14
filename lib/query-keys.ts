import { apiQueryRoots } from './generated/api-contracts'

export const queryKeys = {
  files: (path?: string) => {
    if (path === undefined) return [apiQueryRoots.files] as const
    return [apiQueryRoots.files, path] as const
  },
  filesPage: (path: string, surface?: 'workspace', offset = 0) => {
    if (!surface && offset === 0) return [apiQueryRoots.files, path] as const
    return [apiQueryRoots.files, path, surface ?? 'library', offset] as const
  },
  settings: () => [apiQueryRoots.settings] as const,
  serverConfig: () => [apiQueryRoots.serverConfig] as const,
  stats: () => [apiQueryRoots.stats] as const,
  kb: () => ['kb'] as const,
  adminContent: () => [apiQueryRoots.content, 'admin'] as const,
  kbRecent: (scopePath: string) =>
    [apiQueryRoots.content, 'admin', 'kb-recent', scopePath] as const,
  kbSearch: (root: string, query: string) =>
    [apiQueryRoots.content, 'admin', 'kb-search', root, query] as const,
  textContent: (filePath: string) => [apiQueryRoots.content, 'admin', 'text', filePath] as const,
  audioMetadata: (filePath: string) => [apiQueryRoots.audioMetadata, 'v2', filePath] as const,
  fileSearch: (query?: string) =>
    query === undefined ? (['file-search'] as const) : (['file-search', query] as const),
  fileSearchStatus: () => ['file-search-status'] as const,
} as const
