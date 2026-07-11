export function isRecursiveWatchEligible(input: {
  platform: NodeJS.Platform
  watchMode: 'auto' | 'off'
  rootPath: string
  watcherCount: number
  maxRecursiveWatchers: number
}): boolean {
  if (input.watchMode === 'off' || input.watcherCount >= input.maxRecursiveWatchers) return false
  if (input.platform !== 'win32' && input.platform !== 'darwin') return false
  if (input.platform === 'win32' && /^\\\\/.test(input.rootPath)) return false
  return true
}
