export type ReaderContentKind = 'pdf' | 'directory' | 'book'

export type ReaderPresentation = {
  embedded: boolean
  showClose: boolean
  onClose?: () => void
}

export type ReaderContentProps = ReaderPresentation & {
  sourcePath: string
}

export const basename = (path: string) => path.split(/[/\\]/).filter(Boolean).at(-1) ?? path
