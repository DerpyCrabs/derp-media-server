import { Schema } from 'effect'
import type { DocumentDraft, DraftKind } from './document-drafts'
import {
  drawEditedImage,
  parseImageTransform,
  validImageSize,
} from '@/features/image-editor/image-transform'
import { parsePdfFormValues } from '@/features/reader/contentTypes/pdf/pdf-form-data'
import { noteFormSchema, noteMarkdown } from '@/features/reader/reader-notes'
import { fileNameFromPath } from '@/lib/files/path-utils'
export function draftKindLabel(kind?: DraftKind) {
  return kind === 'image'
    ? 'Image edits'
    : kind === 'pdf'
      ? 'PDF form values'
      : kind === 'reader-note'
        ? 'Reading note'
        : 'Text document'
}
export function recoveredFileName(draft: Pick<DocumentDraft, 'path' | 'kind'>): string {
  const file = fileNameFromPath(draft.path)
  const suffix = file.lastIndexOf('.') > 0 ? (/\.[^.]+$/.exec(file)?.[0] ?? '') : ''
  const extension =
    draft.kind === 'image'
      ? '.png'
      : draft.kind === 'pdf'
        ? '.json'
        : draft.kind === 'reader-note'
          ? '.md'
          : suffix.length <= 20
            ? suffix
            : '.txt'
  let stem = (suffix ? file.slice(0, -suffix.length) : file) || 'Document'
  const parts = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stem),
    (part) => part.segment,
  )
  const encoder = new TextEncoder()
  while (encoder.encode(stem).length > 180) {
    parts.pop()
    stem = parts.join('')
  }
  return `${stem}-recovered${extension}`
}
export function draftText(draft: DocumentDraft): string {
  if (draft.kind === 'pdf') {
    const values = parsePdfFormValues(draft.content)
    if (!values)
      throw new Error('This PDF form backup is invalid. Download its raw data to keep a copy.')
    return JSON.stringify(values, null, 2)
  }
  if (draft.kind === 'reader-note') {
    const parsed = Schema.decodeUnknownExit(Schema.fromJsonString(noteFormSchema))(draft.content)
    if (parsed._tag !== 'Success')
      throw new Error('This reading-note backup is invalid. Download its raw data to keep a copy.')
    const form = parsed.value
    return noteMarkdown(fileNameFromPath(draft.path), [
      {
        ...form,
        path: draft.path,
        revision: form.original?.revision ?? 0,
        createdAt: draft.updatedAt,
        updatedAt: draft.updatedAt,
      },
    ])
  }
  return draft.content
}
export async function renderImageDraft(draft: DocumentDraft, maxDimension?: number): Promise<Blob> {
  const edit = parseImageTransform(draft.content)
  if (!edit || !draft.attachment)
    throw new Error(
      'This image backup is incomplete. Its original bytes or edit instructions are unavailable.',
    )
  const bitmap = await createImageBitmap(draft.attachment)
  const canvas = document.createElement('canvas')
  try {
    if (!validImageSize(bitmap.width, bitmap.height))
      throw new Error('This image is too large to recover in the browser.')
    drawEditedImage(canvas, bitmap, edit, maxDimension)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Could not encode the recovered image.')),
        'image/png',
      ),
    )
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 1
  }
}
export async function exportDocumentDraft(draft: DocumentDraft): Promise<Blob> {
  if (draft.kind === 'image') return renderImageDraft(draft)
  return new Blob([draftText(draft)], {
    type:
      draft.kind === 'pdf'
        ? 'application/json'
        : draft.kind === 'reader-note'
          ? 'text/markdown;charset=utf-8'
          : 'text/plain;charset=utf-8',
  })
}
