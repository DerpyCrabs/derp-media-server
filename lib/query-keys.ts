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
  shares: () => ['shares'] as const,
  stats: () => ['stats'] as const,
  kb: () => ['kb'] as const,
  kbRecent: (scopePath: string) => ['kb-recent', scopePath] as const,
  shareKbRecent: (...args: [] | [token: string] | [token: string, dir: string | undefined]) => {
    if (args.length === 0) return ['share-kb-recent'] as const
    if (args.length === 1) return ['share-kb-recent', args[0]] as const
    return ['share-kb-recent', args[0], args[1]] as const
  },
  kbSearch: (root: string, query: string) => ['kb-search', root, query] as const,
  shareKbSearch: (token: string, query: string, dir: string) =>
    ['share-kb-search', token, query, dir] as const,
  shareInfo: (token: string) => ['share-info', token] as const,
  textContent: (filePath: string) => ['text-content', filePath] as const,
  shareText: (token: string, filePath: string) => ['share-text', token, filePath] as const,
  audioMetadata: (filePath: string) => ['audio-metadata', 'v2', filePath] as const,
  kbChatStatus: () => ['kb-chat-status'] as const,
  kbChatHistory: (kbRoot: string) => ['kb-chat-history', kbRoot] as const,
  kbChatDetail: (chatId: string) => ['kb-chat-detail', chatId] as const,
} as const
