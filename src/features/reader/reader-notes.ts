import { Schema } from 'effect'
import { query } from '@effectweb/query'
import { apiSchemaEffect } from '@/lib/api/client'
import { groups } from '@/lib/api/cache'
export const noteLocationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('paged'), pageIndex: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literal('book'),
    chapterId: Schema.String,
    progress: Schema.Number,
    anchor: Schema.String,
  }),
])
export type NoteLocation = typeof noteLocationSchema.Type
export const readerNoteSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  fingerprint: Schema.String,
  location: noteLocationSchema,
  label: Schema.String,
  quote: Schema.String,
  note: Schema.String,
  revision: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type ReaderNote = typeof readerNoteSchema.Type
export const readerNotesSchema = Schema.Struct({
  items: Schema.Array(readerNoteSchema),
  fingerprint: Schema.String,
})
export const readerNotesQuery = query({
  name: 'reader-notes',
  groups: [groups.readerNotes, groups.files],
  staleTime: 0,
  load: (path: string) =>
    apiSchemaEffect(readerNotesSchema, `/api/reader-notes?path=${encodeURIComponent(path)}`),
})
export type NotePlace = { location: NoteLocation; label: string }
export type ReaderNotesOptions = {
  path: string
  place: (anchor?: HTMLElement) => NotePlace | undefined
  navigate: (location: NoteLocation) => void
  show: () => void
}
export const noteFormSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  quote: Schema.String,
  note: Schema.String,
  fingerprint: Schema.String,
  location: noteLocationSchema,
  original: Schema.NullOr(readerNoteSchema),
})
export type NoteForm = typeof noteFormSchema.Type
export function noteMarkdown(title: string, notes: readonly ReaderNote[]) {
  const heading = (text: string) =>
    text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]<>#])/g, '\\$1')
  return (
    `# ${heading(title)} — reading notes\n\n` +
    notes
      .map((entry) =>
        [
          `## ${heading(entry.label)}`,
          entry.location.kind === 'paged'
            ? `Page ${entry.location.pageIndex + 1}`
            : `Chapter: ${heading(entry.location.chapterId)}`,
          entry.quote
            ? entry.quote
                .split('\n')
                .map((line) => `> ${line}`)
                .join('\n')
            : '',
          entry.note,
        ]
          .filter(Boolean)
          .join('\n\n'),
      )
      .join('\n\n---\n\n') +
    '\n'
  )
}
