export interface NavigationState {
  dir: string | null
  viewing: string | null
  playing: string | null
  audioOnly: boolean
}

export interface NavigationSession {
  state: NavigationState
  navigateToFolder: (path: string | null) => void
  viewFile: (path: string, dir?: string) => void
  playFile: (path: string, dir?: string) => void
  closeViewer: () => void
  closePlayer: () => void
  setAudioOnly: (enabled: boolean) => void
}

export function getParentDirectory(path: string): string | null {
  const parts = path.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('/')
}
