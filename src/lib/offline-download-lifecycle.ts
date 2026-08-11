export type OfflineDownloadOutcome =
  | Readonly<{ kind: 'succeeded' }>
  | Readonly<{ kind: 'failed'; error: unknown; cleanupError?: unknown }>

type OfflineRollbackEntry = Readonly<{ path: string; fileName?: string }>

export type OfflineRollbackPlan<T extends OfflineRollbackEntry> = Readonly<{
  deletePaths: readonly string[]
  restore: readonly T[]
  discardPhysical: readonly T[]
}>

/** Restore entries replaced by a failed refresh without deleting their legacy OPFS files. */
export function buildOfflineRollbackPlan<T extends OfflineRollbackEntry>(
  previous: readonly T[],
  current: readonly T[],
  writtenPaths: readonly string[],
): OfflineRollbackPlan<T> {
  const deletePaths = [...new Set(writtenPaths)]
  const written = new Set(deletePaths)
  const previousByPath = new Map(previous.map((entry) => [entry.path, entry]))
  return {
    deletePaths,
    restore: previous.filter((entry) => written.has(entry.path)),
    discardPhysical: current.filter((entry) => {
      if (!written.has(entry.path) || !entry.fileName) return false
      return previousByPath.get(entry.path)?.fileName !== entry.fileName
    }),
  }
}

export async function executeOfflineDownload(
  operation: () => Promise<void>,
  cleanup: () => Promise<void>,
): Promise<OfflineDownloadOutcome> {
  try {
    await operation()
    return { kind: 'succeeded' }
  } catch (error) {
    try {
      await cleanup()
      return { kind: 'failed', error }
    } catch (cleanupError) {
      return { kind: 'failed', error, cleanupError }
    }
  }
}
