import type { AutoSaveSettingDto } from './generated/api-contracts'

export const MediaType = {
  VIDEO: 'video',
  AUDIO: 'audio',
  IMAGE: 'image',
  TEXT: 'text',
  PDF: 'pdf',
  BOOK: 'book',
  FOLDER: 'folder',
  OTHER: 'other',
} as const

export type MediaType = (typeof MediaType)[keyof typeof MediaType]

export type AutoSaveSettings = AutoSaveSettingDto
