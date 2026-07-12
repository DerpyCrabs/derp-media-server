export const queryKeys = {
  files: (path?: string) => {
    if (path === undefined) return ['files'] as const
    return ['files', path] as const
  },
  shareFiles: (...args: [] | [token: string] | [token: string, dir: string]) => {
    if (args.length === 0) return ['share-files'] as const
    if (args.length === 1) return ['share-files', args[0]] as const
    return ['share-files', args[0], args[1]] as const
  },
  settings: () => ['settings'] as const,
  authConfig: () => ['auth-config'] as const,
  mounts: () => ['mounts'] as const,
  shares: () => ['shares'] as const,
  stats: () => ['stats'] as const,
  kb: () => ['kb'] as const,
  adminContent: () => ['content', 'admin'] as const,
  shareContent: (token: string) => ['content', 'share', token] as const,
  kbRecent: (scopePath: string) => ['content', 'admin', 'kb-recent', scopePath] as const,
  shareKbRecent: (...args: [] | [token: string] | [token: string, dir: string | undefined]) => {
    if (args.length === 0) return ['content', 'share'] as const
    if (args.length === 1) return ['content', 'share', args[0], 'kb-recent'] as const
    return ['content', 'share', args[0], 'kb-recent', args[1]] as const
  },
  kbSearch: (root: string, query: string) =>
    ['content', 'admin', 'kb-search', root, query] as const,
  shareKbSearch: (token: string, query: string, dir: string) =>
    ['content', 'share', token, 'kb-search', query, dir] as const,
  shareInfo: (token: string) => ['share-info', token] as const,
  textContent: (filePath: string) => ['content', 'admin', 'text', filePath] as const,
  shareText: (token: string, filePath: string) =>
    ['content', 'share', token, 'text', filePath] as const,
  audioMetadata: (filePath: string) => ['audio-metadata', 'v2', filePath] as const,
  kbChatStatus: () => ['kb-chat-status'] as const,
  kbChatHistory: (kbRoot: string) => ['kb-chat-history', kbRoot] as const,
  kbChatDetail: (chatId: string) => ['kb-chat-detail', chatId] as const,
  fileSearch: (query?: string) =>
    query === undefined ? (['file-search'] as const) : (['file-search', query] as const),
  fileSearchStatus: () => ['file-search-status'] as const,
} as const
