export interface DesktopTarget {
  path: string
  isDirectory: boolean
  mediaType: string
  reader?: boolean
}

export interface DesktopBridge {
  onPicker?(callback: (request: PickerRequest) => void): () => void
  pick?(selection: PickerSelection): Promise<{ overwrite?: string[] }>
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

export interface PickerRequest {
  mode: 'OpenFile' | 'SaveFile' | 'SaveFiles'
  directory: boolean
  multiple: boolean
  name: string
  acceptLabel: string
  filters: { name: string; rules: { type: number; value: string; patterns: string[] }[] }[]
  filter: number
  choices: {
    id: string
    label: string
    options: { id: string; label: string }[]
    selected: string
  }[]
}

export interface PickerSelection {
  paths: string[]
  directory: string
  name: string
  filter: number
  choices: Record<string, string>
  overwrite?: boolean
}
