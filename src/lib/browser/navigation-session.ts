export interface NavigationState {
  dir: string | null
  viewing: string | null
  playing: string | null
  audioOnly: boolean
  imageSeed?: string | null
  readerKind: 'pdf' | 'folder' | 'book' | null
}
