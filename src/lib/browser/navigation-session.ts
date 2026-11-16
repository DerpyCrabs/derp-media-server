export interface NavigationState {
  reveal?: { directory: string; paths: readonly string[]; properties?: boolean }
  dir: string | null
  viewing: string | null
  playing: string | null
  audioOnly: boolean
  imageSeed?: string | null
  readerKind: 'pdf' | 'folder' | 'book' | null
}
