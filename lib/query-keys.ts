export const queryKeys = {
  files: (path?: string) => {
    if (path === undefined) return ['files'] as const
    return ['files', path] as const
  },
  settings: () => ['settings'] as const,
  serverConfig: () => ['server-config'] as const,
  mounts: () => ['mounts'] as const,
  stats: () => ['stats'] as const,
  kb: () => ['kb'] as const,
  adminContent: () => ['content', 'admin'] as const,
  kbRecent: (scopePath: string) => ['content', 'admin', 'kb-recent', scopePath] as const,
  kbSearch: (root: string, query: string) =>
    ['content', 'admin', 'kb-search', root, query] as const,
  textContent: (filePath: string) => ['content', 'admin', 'text', filePath] as const,
  audioMetadata: (filePath: string) => ['audio-metadata', 'v2', filePath] as const,
  fileSearch: (query?: string) =>
    query === undefined ? (['file-search'] as const) : (['file-search', query] as const),
  fileSearchStatus: () => ['file-search-status'] as const,
} as const
