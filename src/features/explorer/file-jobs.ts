import { Effect, Schema } from 'effect'
import { available, modelOwner } from 'effectweb'
import { query, observeQuery } from '@effectweb/query'
import { apiSchemaEffect, postSchemaEffect, postEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'

export type FileOperation =
  | 'copy'
  | 'move'
  | 'delete'
  | 'trash'
  | 'createArchive'
  | 'extractArchive'
const jobSchema = Schema.Struct({
  id: Schema.String,
  operation: Schema.String,
  status: Schema.String,
  total: Schema.Number,
  completed: Schema.Number,
  skipped: Schema.Number,
  bytes: Schema.Number,
  current: Schema.String,
  conflict: Schema.NullOr(Schema.String),
  errors: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
})
export type FileJob = typeof jobSchema.Type
const nativeSchema = Schema.Struct({
  jobs: Schema.Array(jobSchema),
  managedIds: Schema.Array(Schema.String),
})
const nativeEffect = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
const definition = query({
  name: 'file-operations',
  load: (enabled: true) => {
    void enabled
    return apiSchemaEffect(Schema.Array(jobSchema), '/api/file-jobs').pipe(
      Effect.flatMap((jobs) =>
        window.derpDesktop?.nativeJobs
          ? nativeEffect(() => window.derpDesktop!.nativeJobs!()).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(nativeSchema)),
              Effect.map((native) => [
                ...jobs.filter((job) => !native.managedIds.includes(job.id)),
                ...native.jobs,
              ]),
              Effect.mapError((error) =>
                error instanceof Error ? error : new Error(String(error)),
              ),
            )
          : Effect.succeed(jobs),
      ),
    )
  },
})
const owner = modelOwner({
  jobs: [] as readonly FileJob[],
  error: '',
  pending: false,
  clipboard: null as { paths: string[]; cut: boolean } | null,
})
const active = (job: FileJob) => ['queued', 'running', 'conflict'].includes(job.status)
let subscribed = false
const resource = observeQuery(owner, queryCache, definition, (result) => {
  if (result._tag === 'Failure') {
    owner.patch({ error: 'Cannot refresh operations. Retrying…' })
    owner.run(
      'poll',
      Effect.sleep(2000).pipe(Effect.andThen(Effect.sync(resource.refresh))),
      'replace',
    )
    return
  }
  const jobs = available(result)
  if (!jobs || result.waiting) return
  const previous = owner.read().jobs
  const changedFiles = jobs.some((job) => {
    const before = previous.find((item) => item.id === job.id)
    return before && (before.completed !== job.completed || (active(before) && !active(job)))
  })
  owner.patch({ jobs, error: '' })
  if (changedFiles) {
    queryCache.invalidateGroup(groups.files)
    queryCache.invalidateGroup(groups.content)
  }
  if (jobs.some(active))
    owner.run(
      'poll',
      Effect.sleep(750).pipe(Effect.andThen(Effect.sync(resource.refresh))),
      'replace',
    )
})
function refresh() {
  if (!subscribed) {
    resource.select(true)
    subscribed = true
  } else resource.refresh()
}
function command(effect: Effect.Effect<unknown, Error>) {
  owner.run(
    'command',
    effect.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          owner.patch({ error: '', pending: false })
          refresh()
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => owner.patch({ error: error.message, pending: false })),
      ),
    ),
    'queue',
  )
}
export const fileJobs = {
  source: owner.source,
  read: owner.read,
  refresh,
  active,
  copy: (paths: string[], cut = false) => owner.patch({ clipboard: { paths, cut } }),
  clearClipboard: () => owner.patch({ clipboard: null }),
  start(request: {
    operation: FileOperation
    paths: string[]
    destination?: string
    name?: string
    entries?: string[]
  }) {
    owner.patch({ pending: true, error: '' })
    command(postSchemaEffect(Schema.Struct({ id: Schema.String }), '/api/file-jobs', request))
  },
  cancel: (id: string) =>
    command(
      id.startsWith('native-') && window.derpDesktop?.cancelNativeJob
        ? nativeEffect(() => window.derpDesktop!.cancelNativeJob!(id))
        : postEffect(`/api/file-jobs/${id}/cancel`, {}),
    ),
  decide: (id: string, choice: 'skip' | 'replace' | 'keepBoth', all: boolean) =>
    command(
      id.startsWith('native-') && window.derpDesktop?.decideNativeJob
        ? nativeEffect(() => window.derpDesktop!.decideNativeJob!(id, choice, all))
        : postEffect(`/api/file-jobs/${id}/conflict`, { choice, all }),
    ),
}
