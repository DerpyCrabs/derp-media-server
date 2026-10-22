import { Effect } from 'effect'

function readAllEntries(reader: FileSystemDirectoryReader) {
  return Effect.gen(function* () {
    const entries: FileSystemEntry[] = []
    while (true) {
      const batch = yield* Effect.callback<FileSystemEntry[], DOMException>((resume) => {
        reader.readEntries(
          (value) => resume(Effect.succeed(value)),
          (error) => resume(Effect.fail(error)),
        )
      })
      if (!batch.length) return entries
      entries.push(...batch)
    }
  })
}

function readEntry(entry: FileSystemEntry, basePath: string): Effect.Effect<File[], DOMException> {
  return Effect.gen(function* () {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name
    if (entry.isFile) {
      const file = yield* Effect.callback<File, DOMException>((resume) => {
        ;(entry as FileSystemFileEntry).file(
          (value) => resume(Effect.succeed(value)),
          (error) => resume(Effect.fail(error)),
        )
      })
      return [new File([file], relativePath, { type: file.type, lastModified: file.lastModified })]
    }
    if (entry.isDirectory) {
      const entries = yield* readAllEntries((entry as FileSystemDirectoryEntry).createReader())
      const nested = yield* Effect.forEach(entries, (child) => readEntry(child, relativePath), {
        concurrency: 'unbounded',
      })
      return nested.flat()
    }
    return []
  })
}

export function collectDroppedUploadFiles(dataTransfer: DataTransfer) {
  // DataTransfer access is restricted to the browser event dispatch.
  const entries = Array.from(dataTransfer.items ?? []).flatMap((item) => {
    const entry = item.webkitGetAsEntry?.()
    return entry ? [entry] : []
  })
  const files = Array.from(dataTransfer.files)
  return entries.length
    ? Effect.forEach(entries, (entry) => readEntry(entry, ''), { concurrency: 'unbounded' }).pipe(
        Effect.map((groups) => groups.flat()),
      )
    : Effect.succeed(files)
}
