import { Effect } from 'effect'
import { available, modelOwner } from 'effectweb'
import { observeQuery } from '@effectweb/query'
import { configQuery } from '@/lib/api/queries'
import { apiEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import {
  createDocumentDraftWriter,
  findDocumentDrafts,
  removeDocumentDraft,
  type DocumentDraft,
} from '@/lib/editor/document-drafts'
import { registerDesktopCloseHandler } from '@/desktop/close-handlers'
import type { PdfDocument } from './PdfContent'
import { isPdfFieldValue, parsePdfFormValues, type PdfFormValues } from './pdf-form-data'
const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => error })
export function createPdfForms(pdf: PdfDocument, path: string, fields: Map<string, object[]>) {
  const names = new Map<string, string>()
  for (const [name, widgets] of fields)
    for (const field of widgets)
      if (
        'id' in field &&
        typeof field.id === 'string' &&
        'type' in field &&
        field.type !== 'signature' &&
        field.type !== 'button'
      )
        names.set(field.id, name)
  if (!names.size) return undefined
  const version = pdf.fingerprints.join(':')
  const writer = createDocumentDraftWriter(path, 'pdf')
  let restored: DocumentDraft | undefined
  let saved = '{}'
  const owner = modelOwner({
    dirty: false,
    draftSaved: false,
    draftError: '',
    error: '',
    pending: false,
    saveDialog: false,
    savedPath: '',
    revision: 0,
    drafts: [] as DocumentDraft[],
    editableFolders: [] as readonly string[],
  })
  const snapshot = () => {
    const values: PdfFormValues = Object.create(null)
    for (const [id, name] of names) {
      const field = pdf.annotationStorage.getRawValue(id)
      if (field && 'value' in field && isPdfFieldValue(field.value))
        values[id] = { name, value: field.value }
    }
    return JSON.stringify(values)
  }
  const persist = async () => {
    const content = snapshot(),
      dirty = owner.read().dirty
    try {
      await writer.write(dirty ? content : null, version)
      if (!owner.disposed && content === snapshot())
        owner.patch({ draftSaved: dirty, draftError: '' })
    } catch (error) {
      if (!owner.disposed)
        owner.patch({
          draftSaved: false,
          draftError: 'Could not back up form entries. Save a copy before closing.',
        })
      throw error
    }
  }
  const changed = () => {
    owner.patch({ dirty: snapshot() !== saved, draftSaved: false, savedPath: '' })
    owner.run(
      'draft',
      Effect.sleep(200).pipe(
        Effect.andThen(attempt(persist)),
        Effect.catch(() => Effect.void),
      ),
      'replace',
    )
  }
  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob),
      link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
    owner.run(
      `url-${url}`,
      Effect.sleep(60_000).pipe(Effect.ensuring(Effect.sync(() => URL.revokeObjectURL(url)))),
      'replace',
    )
  }
  const exportPdf = (destination: string, download: boolean) => {
    if (owner.read().pending) return
    owner.patch({ pending: true, error: '' })
    owner.run(
      'export',
      Effect.gen(function* () {
        const content = snapshot()
        const bytes = yield* attempt(() => pdf.saveDocument())
        const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
        if (download) downloadBlob(blob, fileNameFromPath(destination))
        else {
          const form = new FormData()
          form.append('targetDir', parentPath(destination))
          form.append('file', blob, fileNameFromPath(destination))
          yield* apiEffect('/api/files/upload?create_only=true', { method: 'POST', body: form })
          saved = content
          owner.patch({ dirty: snapshot() !== saved })
          if (restored) {
            const draft = restored
            restored = undefined
            yield* attempt(() => removeDocumentDraft(draft)).pipe(Effect.catch(() => Effect.void))
          }
          yield* attempt(persist).pipe(Effect.catch(() => Effect.void))
          queryCache.invalidateGroup(groups.files)
        }
        owner.patch({
          pending: false,
          saveDialog: false,
          dirty: download ? owner.read().dirty : snapshot() !== saved,
          savedPath: download ? '' : destination,
        })
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            owner.patch({
              pending: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
        ),
      ),
      'drop',
    )
  }
  observeQuery(owner, queryCache, configQuery, (result) =>
    owner.patch({ editableFolders: available(result)?.editableFolders ?? [] }),
  ).select(true)
  owner.run(
    'recover',
    attempt(() => findDocumentDrafts(path, 'pdf')).pipe(
      Effect.tap((drafts) =>
        Effect.sync(() =>
          owner.patch({ drafts: drafts.filter((draft) => parsePdfFormValues(draft.content)) }),
        ),
      ),
      Effect.catch(() =>
        Effect.sync(() =>
          owner.patch({
            draftError: 'Browser backup storage is unavailable. Save a copy before closing.',
          }),
        ),
      ),
    ),
    'drop',
  )
  const flush = () => {
    void persist().catch(() => {})
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    flush()
    if (owner.read().dirty && !owner.read().draftSaved) event.preventDefault()
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', beforeUnload)
  const beforeClose = () =>
    owner.read().dirty
      ? attempt(persist).pipe(
          Effect.mapError(
            () => new Error('Form entries could not be backed up. Save a copy before closing.'),
          ),
        )
      : Effect.void
  const unregister = registerDesktopCloseHandler(beforeClose)
  return {
    beforeClose,
    source: owner.source,
    read: owner.read,
    changed,
    fields,
    openSave: () => owner.patch({ saveDialog: true, error: '' }),
    closeSave: () => {
      if (!owner.read().pending) owner.patch({ saveDialog: false })
    },
    save: (destination: string) => exportPdf(destination, false),
    download: (name = fileNameFromPath(path).replace(/\.pdf$/i, '-filled.pdf')) =>
      exportPdf(name, true),
    compatible: (draft: DocumentDraft) => draft.version === version,
    restore: () => {
      const draft = owner.read().drafts[0]
      if (!draft || draft.version !== version || owner.read().dirty) return
      const values = parsePdfFormValues(draft.content)
      if (!values) return
      for (const [id, field] of Object.entries(values))
        if (names.get(id) === field.name) pdf.annotationStorage.setValue(id, { value: field.value })
      restored = draft
      owner.patch({ drafts: owner.read().drafts.slice(1), revision: owner.read().revision + 1 })
      changed()
    },
    discardDraft: () => {
      const draft = owner.read().drafts[0]
      if (!draft) return
      owner.run(
        'discard',
        attempt(() => removeDocumentDraft(draft)).pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              owner.patch({ drafts: owner.read().drafts.filter((item) => item !== draft) }),
            ),
          ),
          Effect.catch(() =>
            Effect.sync(() => owner.patch({ error: 'Could not remove the saved draft.' })),
          ),
        ),
        'drop',
      )
    },
    downloadDraft: () => {
      const draft = owner.read().drafts[0]
      if (draft)
        downloadBlob(
          new Blob([JSON.stringify(parsePdfFormValues(draft.content), null, 2)], {
            type: 'application/json',
          }),
          `${fileNameFromPath(path)}-form-entries.json`,
        )
    },
    close: () =>
      attempt(persist).pipe(
        Effect.catch(() => Effect.void),
        Effect.ensuring(
          Effect.sync(() => {
            unregister?.()
            window.removeEventListener('pagehide', flush)
            window.removeEventListener('beforeunload', beforeUnload)
            owner.dispose()
          }),
        ),
      ),
  }
}
export type PdfForms = NonNullable<ReturnType<typeof createPdfForms>>
