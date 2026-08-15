export type BookFormat = 'epub' | 'fb2'

export type BookMetadata = {
  title: string
  authors: string[]
  language?: string
  series?: string
}

export type BookOutlineItem = {
  id: string
  label: string
  chapterId: string
  anchor?: string
  children: BookOutlineItem[]
}

export type BookChapter = {
  id: string
  href: string
  title: string
  markup: string
  textLength: number
}

export type BookResource = {
  path: string
  mediaType: string
  bytes: Uint8Array
}

export type BookDocument = {
  format: BookFormat
  metadata: BookMetadata
  chapters: BookChapter[]
  outline: BookOutlineItem[]
  resources: BookResource[]
  styles: Array<{ path: string; css: string }>
}

export type BookWorkerRequest = {
  bytes: ArrayBuffer
  fileName: string
}

export type BookWorkerResponse = { ok: true; document: BookDocument } | { ok: false; error: string }
