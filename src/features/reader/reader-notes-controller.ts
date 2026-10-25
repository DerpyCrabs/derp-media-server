import { Effect, Schema } from 'effect'
import { available, modelOwner } from 'effectweb'
import { observeQuery } from '@effectweb/query'
import { ApiError, apiSchemaEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { randomId } from '@/lib/random-id'
import { downloadBlob } from '@/lib/files/download-blob'
import { nativeDownload } from '@/lib/browser/native-download'
import { fileNameFromPath } from '@/lib/files/path-utils'
import {
  createDocumentDraftWriter,
  findDocumentDrafts,
  removeDocumentDraft,
  type DocumentDraft,
} from '@/lib/editor/document-drafts'
import {
  noteFormSchema,
  noteMarkdown,
  readerNoteSchema,
  readerNotesQuery,
  type NoteForm,
  type ReaderNote,
  type ReaderNotesOptions,
} from './reader-notes'

function recoveredForm(draft: DocumentDraft): NoteForm | undefined {
  const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(noteFormSchema))(draft.content)
  return decoded._tag === 'Success' ? decoded.value : undefined
}
export function createReaderNotes(options: ReaderNotesOptions) {
  const owner = modelOwner({
    items: [] as readonly ReaderNote[],
    fingerprint: '',
    loading: true,
    error: '',
    pending: false,
    conflict: false,
    form: null as NoteForm | null,
    filter: '',
    limit: 50,
    deleteId: '',
    drafts: [] as DocumentDraft[],
    draftSaved: false,
    draftError: '',
  })
  const writer = createDocumentDraftWriter(options.path, 'reader-note')
  let restored: DocumentDraft | undefined
  const dirty = () => {
    const form = owner.read().form
    return (
      !!form &&
      (!form.original || form.label !== form.original.label || form.note !== form.original.note)
    )
  }
  const persist = async () => {
    const state = owner.read()
    await writer.write(
      dirty() && state.form ? JSON.stringify(state.form) : null,
      state.form?.fingerprint ?? '',
    )
    if (!owner.disposed) owner.patch({ draftSaved: dirty(), draftError: '' })
  }
  function schedule() {
    owner.patch({ draftSaved: false })
    owner.run(
      'draft',
      Effect.sleep(200).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: persist,
            catch: () => new Error('Local backup is unavailable. Save the note before closing.'),
          }),
        ),
        Effect.catch((error) => Effect.sync(() => owner.patch({ draftError: error.message }))),
      ),
      'replace',
    )
  }
  const observer = observeQuery(owner, queryCache, readerNotesQuery, (result) => {
    const data = available(result)
    owner.patch({
      items: data?.items ?? owner.read().items,
      fingerprint: data?.fingerprint ?? owner.read().fingerprint,
      loading: result.waiting,
      ...(result._tag === 'Failure' ? { error: 'Could not load reading notes. Try again.' } : {}),
    })
  })
  observer.select(options.path)
  owner.run(
    'recovery',
    Effect.tryPromise(() => findDocumentDrafts(options.path, 'reader-note')).pipe(
      Effect.tap((drafts) =>
        Effect.sync(() =>
          owner.patch({ drafts: drafts.filter((draft) => !!recoveredForm(draft)) }),
        ),
      ),
      Effect.catch(() => Effect.void),
    ),
    'drop',
  )
  function clearDraft() {
    owner.cancel('draft')
    const previous = restored
    restored = undefined
    owner.patch({
      form: null,
      conflict: false,
      draftSaved: false,
      draftError: '',
      drafts: owner.read().drafts.filter((draft) => draft.id !== previous?.id),
    })
    owner.run(
      'clear-draft',
      Effect.tryPromise(async () => {
        await writer.write(null, '')
        if (previous) await removeDocumentDraft(previous)
      }).pipe(Effect.ignore),
      'queue',
    )
  }
  function run<A, E extends { message: string }>(effect: Effect.Effect<A, E>, done: () => void) {
    if (owner.read().pending) return
    owner.patch({ pending: true, error: '' })
    owner.run(
      'mutation',
      effect.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            owner.patch({ pending: false })
            queryCache.invalidateGroup(groups.readerNotes)
            done()
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() =>
            owner.patch({
              pending: false,
              error: error.message,
              conflict:
                error instanceof ApiError && error.status === 409 && !!owner.read().form?.original,
            }),
          ),
        ),
      ),
      'drop',
    )
  }
  const onPageHide = () => {
    void persist().catch(() => {})
  }
  window.addEventListener('pagehide', onPageHide)
  owner.own({ dispose: () => window.removeEventListener('pagehide', onPageHide) })
  return {
    source: owner.source,
    read: owner.read,
    beforeClose: () =>
      Effect.tryPromise({
        try: persist,
        catch: () =>
          new Error(
            'This reading note has no local backup. Save or cancel the note before closing.',
          ),
      }),
    create: (quote = '', anchor?: HTMLElement) => {
      options.show()
      if (owner.read().form) {
        owner.patch({ error: 'Save or cancel the unfinished note first.' })
        return false
      }
      const place = options.place(anchor),
        fingerprint = owner.read().fingerprint
      if (!place || !fingerprint || owner.read().pending) {
        owner.patch({ error: 'Wait for reading notes to load, then try again.' })
        return false
      }
      owner.patch({
        form: { ...place, id: randomId(), quote, note: '', fingerprint, original: null },
        error: '',
      })
      schedule()
      return true
    },
    edit: (entry: ReaderNote) => {
      if (owner.read().pending || owner.read().form) return
      owner.patch({ form: { ...entry, original: entry }, error: '' })
    },
    change: (change: Partial<Pick<NoteForm, 'label' | 'note'>>) => {
      const form = owner.read().form
      if (!form || owner.read().pending) return
      owner.patch({ form: { ...form, ...change } })
      schedule()
    },
    cancel: () => {
      if (!owner.read().pending) {
        clearDraft()
        owner.patch({ error: '' })
      }
    },
    keepAsNew: () => {
      const state = owner.read(),
        form = state.form
      if (!form?.original || state.pending || form.fingerprint !== state.fingerprint) return
      owner.patch({ form: { ...form, original: null, id: randomId() }, conflict: false, error: '' })
      schedule()
    },
    save: () => {
      const form = owner.read().form
      if (!form || !form.label.trim()) return
      const body = form.original
        ? {
            path: options.path,
            revision: form.original.revision,
            label: form.label,
            note: form.note,
          }
        : {
            id: form.id,
            path: options.path,
            fingerprint: form.fingerprint,
            location: form.location,
            label: form.label,
            quote: form.quote,
            note: form.note,
          }
      run(
        apiSchemaEffect(
          readerNoteSchema,
          form.original ? `/api/reader-notes/${encodeURIComponent(form.id)}` : '/api/reader-notes',
          { method: form.original ? 'PATCH' : 'POST', body: JSON.stringify(body) },
        ),
        clearDraft,
      )
    },
    navigate: (entry: ReaderNote) => {
      if (entry.fingerprint === owner.read().fingerprint) options.navigate(entry.location)
    },
    reload: () => {
      owner.patch({ error: '' })
      observer.refresh()
    },
    filter: (filter: string) => owner.patch({ filter, limit: 50 }),
    more: () => owner.patch({ limit: owner.read().limit + 50 }),
    confirmDelete: (deleteId: string) => owner.patch({ deleteId }),
    remove: (entry: ReaderNote) =>
      run(
        apiSchemaEffect(
          Schema.Struct({ ok: Schema.Boolean }),
          `/api/reader-notes/${encodeURIComponent(entry.id)}?path=${encodeURIComponent(options.path)}&revision=${entry.revision}`,
          { method: 'DELETE' },
        ),
        () => owner.patch({ deleteId: '' }),
      ),
    restore: (draft: DocumentDraft) => {
      const form = recoveredForm(draft)
      if (!form || owner.read().form || form.fingerprint !== owner.read().fingerprint) return
      restored = draft
      owner.patch({ form, error: '' })
      schedule()
    },
    discardDraft: (draft: DocumentDraft) =>
      run(
        Effect.tryPromise({
          try: () => removeDocumentDraft(draft),
          catch: () => new Error('Could not discard the local draft.'),
        }),
        () => owner.patch({ drafts: owner.read().drafts.filter((item) => item.id !== draft.id) }),
      ),
    export: (draft?: DocumentDraft) => {
      const form = draft ? recoveredForm(draft) : undefined
      const items = form
        ? [
            {
              ...form,
              path: options.path,
              revision: form.original?.revision ?? 0,
              createdAt: draft!.updatedAt,
              updatedAt: draft!.updatedAt,
            },
          ]
        : owner.read().items
      const blob = new Blob([noteMarkdown(fileNameFromPath(options.path), items)], {
        type: 'text/markdown;charset=utf-8',
      })
      const name = `${fileNameFromPath(options.path).replace(/\.[^.]+$/, '')}-notes.md`
      if (window.derpDesktop?.downloadBlob) run(nativeDownload(blob, name), () => {})
      else downloadBlob(blob, name)
    },
    lifetime: {
      dispose: () => {
        void persist().catch(() => {})
        owner.dispose()
      },
    },
  }
}
export type ReaderNotesController = ReturnType<typeof createReaderNotes>
