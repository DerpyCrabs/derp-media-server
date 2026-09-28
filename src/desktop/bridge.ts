export interface DesktopTarget {
  path: string
  isDirectory: boolean
  mediaType: string
  reader?: boolean
}

export interface DesktopBridge {
  ready(): Promise<void>
  onBeforeClose(callback: () => Promise<void>): () => void
  onOpen(callback: (target: DesktopTarget) => void): () => void
  open(path: string, reader?: boolean): Promise<void>
  openRoot(): Promise<void>
  copy(paths: string[]): Promise<void>
  drag(paths: string[]): Promise<void>
  paste(directory: string): Promise<number>
  hasFileClipboard(): Promise<boolean>
  importDrop(files: File[], directory: string): Promise<number>
  openDrop(files: File[]): Promise<void>
  close(): void
}

declare global {
  interface Window {
    derpDesktop?: DesktopBridge
  }
}
