import { Database } from 'bun:sqlite'
import { mkdir, opendir, rm, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { shouldExcludeFile, shouldExcludeFolder } from '@/lib/file-exclusions'
import {
  normalizeFileSearchText,
  type FileSearchResponse,
  type FileSearchResult,
  type FileSearchRootState,
  type FileSearchStatus,
} from '@/lib/file-search'
import { getMediaType } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { isRecursiveWatchEligible } from '@/lib/file-search-watcher-policy'

type SearchRoot = {
  id: string
  name: string
  path: string
  source: 'config' | 'mount'
}

type WorkerConfig = {
  enabled: boolean
  indexPath: string
  watchMode: 'auto' | 'off'
  maxRecursiveWatchers: number
  maxFsConcurrency: number
  reconcileDirectoriesPerSecond: number
}

type WorkerRequest =
  | { id: number; type: 'init'; config: WorkerConfig; roots: SearchRoot[] }
  | { id: number; type: 'search'; query: string; limit: number }
  | { id: number; type: 'status' }
  | { id: number; type: 'sync-roots'; roots: SearchRoot[] }
  | { id: number; type: 'file-change'; directory: string; changedPath?: string }
  | { id: number; type: 'reindex'; mode: 'reconcile' | 'full'; rootId?: string }
  | { id: number; type: 'shutdown' }

type WorkerResponse =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: string }

type EntryRow = {
  id: number
  root_id: string
  relative_path: string
  parent_path: string
  name: string
  name_key: string
  path_key: string
  is_directory: number
  extension: string
  media_type: string
  directory_mtime: number | null
  directory_birthtime: number | null
}

type RootRow = {
  root_id: string
  name: string
  root_path: string
  source: 'config' | 'mount'
  state: FileSearchRootState
  refresh_mode: 'recursive-watch' | 'polling' | 'degraded'
  generation: number
  indexed_entries: number
  scanned_directories: number
  last_complete_at: number | null
  error: string | null
  root_mtime: number | null
  root_birthtime: number | null
}

const SCHEMA_VERSION = 2
const ENTRY_BATCH_SIZE = 2_000
const MAX_PENDING_DIRECTORIES = 2_048
const WATCH_DEBOUNCE_MS = 200
const SEARCH_CANDIDATE_LIMIT = 500

let db: Database | null = null
let config: WorkerConfig | null = null
let disabledError: string | undefined
const roots = new Map<string, SearchRoot>()
const watchers = new Map<string, FSWatcher>()
const pendingDirectories = new Map<string, Set<string>>()
const collapsedRoots = new Set<string>()
const degradedWatcherRoots = new Set<string>()
let pendingDirectoryCount = 0
let pendingTimer: ReturnType<typeof setTimeout> | undefined
let closed = false
let workChain: Promise<void> = Promise.resolve()
let targetToken = Date.now()

function post(response: WorkerResponse) {
  globalThis.postMessage(response)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeRelative(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\/+/, '')
  return normalized === '.' ? '' : normalized
}

function parentRelative(value: string): string {
  const parent = path.posix.dirname(value)
  return parent === '.' ? '' : parent
}

function logicalPath(root: SearchRoot, relativePath: string): string {
  if (roots.size <= 1) return relativePath
  return relativePath ? `${root.name}/${relativePath}` : root.name
}

function globEscape(value: string): string {
  return value.replaceAll('[', '[[]').replaceAll('*', '[*]').replaceAll('?', '[?]')
}

function shouldIgnoreRelative(relativePath: string, isDirectory: boolean): boolean {
  const parts = normalizeRelative(relativePath).split('/').filter(Boolean)
  for (let i = 0; i < parts.length - 1; i++) {
    if (shouldExcludeFolder(parts[i])) return true
  }
  const name = parts.at(-1) ?? ''
  return isDirectory ? shouldExcludeFolder(name) : shouldExcludeFile(name)
}

function openDatabase(indexPath: string): Database {
  const database = new Database(indexPath, { create: true, strict: true })
  try {
    database.run('PRAGMA foreign_keys = ON')
    database.run('PRAGMA synchronous = NORMAL')
    database.run('PRAGMA cache_size = -32768')
    database.run('PRAGMA temp_store = MEMORY')
    try {
      database.run('PRAGMA journal_mode = WAL')
      database.run('PRAGMA journal_size_limit = 33554432')
    } catch {
      database.run('PRAGMA journal_mode = DELETE')
    }

    const version = Number(
      (database.query('PRAGMA user_version').get() as { user_version?: number } | null)
        ?.user_version ?? 0,
    )
    const rebuildMissingFts =
      version === SCHEMA_VERSION &&
      !!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='entries'").get() &&
      !database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='entries_fts'").get()
    if (version !== 0 && version !== SCHEMA_VERSION) {
      database.exec(`
      DROP TABLE IF EXISTS entries_fts;
      DROP TABLE IF EXISTS crawl_queue;
      DROP TABLE IF EXISTS entries;
      DROP TABLE IF EXISTS roots;
    `)
    }
    database.exec(`
    CREATE TABLE IF NOT EXISTS roots (
      root_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      source TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'building',
      refresh_mode TEXT NOT NULL DEFAULT 'polling',
      generation INTEGER NOT NULL DEFAULT 0,
      indexed_entries INTEGER NOT NULL DEFAULT 0,
      scanned_directories INTEGER NOT NULL DEFAULT 0,
      last_complete_at INTEGER,
      error TEXT,
      root_mtime REAL
      ,root_birthtime REAL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY,
      root_id TEXT NOT NULL REFERENCES roots(root_id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      parent_path TEXT NOT NULL,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      path_key TEXT NOT NULL,
      is_directory INTEGER NOT NULL,
      extension TEXT NOT NULL,
      media_type TEXT NOT NULL,
      directory_mtime REAL,
      directory_birthtime REAL,
      generation INTEGER NOT NULL,
      seen_token INTEGER NOT NULL DEFAULT 0,
      UNIQUE(root_id, relative_path)
    );
    CREATE INDEX IF NOT EXISTS entries_root_parent ON entries(root_id, parent_path);
    CREATE INDEX IF NOT EXISTS entries_root_path ON entries(root_id, relative_path);
    CREATE INDEX IF NOT EXISTS entries_name_key ON entries(name_key);
    CREATE INDEX IF NOT EXISTS entries_root_directory_id ON entries(root_id, is_directory, id);
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      name_key,
      path_key,
      content='entries',
      content_rowid='id',
      tokenize='trigram case_sensitive 1'
    );
    CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entries_fts(rowid, name_key, path_key)
      VALUES (new.id, new.name_key, new.path_key);
    END;
    CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, name_key, path_key)
      VALUES ('delete', old.id, old.name_key, old.path_key);
    END;
    CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE OF name_key, path_key ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, name_key, path_key)
      VALUES ('delete', old.id, old.name_key, old.path_key);
      INSERT INTO entries_fts(rowid, name_key, path_key)
      VALUES (new.id, new.name_key, new.path_key);
    END;
    CREATE TABLE IF NOT EXISTS crawl_queue (
      root_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      generation INTEGER NOT NULL,
      PRIMARY KEY(root_id, relative_path)
    );
    PRAGMA user_version = ${SCHEMA_VERSION};
  `)
    database.run(
      "CREATE VIRTUAL TABLE IF NOT EXISTS __fts_probe USING fts5(value, tokenize='trigram')",
    )
    database.run('DROP TABLE __fts_probe')
    if (rebuildMissingFts) {
      database.run("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')")
    }
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

function database(): Database {
  if (!db) throw new Error(disabledError ?? 'File search is not initialized')
  return db
}

function checkpointDatabase(truncate = false) {
  try {
    database().run(`PRAGMA wal_checkpoint(${truncate ? 'TRUNCATE' : 'PASSIVE'})`)
  } catch {
    // DELETE-journal databases and busy readers do not require a successful WAL checkpoint.
  }
}

function enqueueWork(task: () => Promise<void>): Promise<void> {
  const next = workChain.then(task, task)
  workChain = next.catch((error) => {
    console.error('[File search worker]', error)
  })
  return next
}

function upsertRoot(root: SearchRoot, state: FileSearchRootState = 'building') {
  database()
    .query(
      `INSERT INTO roots(root_id, name, root_path, source, state)
       VALUES ($id, $name, $path, $source, $state)
       ON CONFLICT(root_id) DO UPDATE SET
         name=excluded.name,
         root_path=excluded.root_path,
         source=excluded.source`,
    )
    .run({ id: root.id, name: root.name, path: root.path, source: root.source, state })
}

function rootRow(rootId: string): RootRow | null {
  return database().query('SELECT * FROM roots WHERE root_id = ?').get(rootId) as RootRow | null
}

function canonicalRoot(input: SearchRoot): SearchRoot {
  return { ...input, path: path.resolve(input.path) }
}

async function syncRoots(nextRoots: SearchRoot[]): Promise<string[]> {
  const normalized = nextRoots.map(canonicalRoot)
  const nextIds = new Set(normalized.map((root) => root.id))
  const rebuild: string[] = []

  for (const existingId of roots.keys()) {
    if (nextIds.has(existingId)) continue
    closeWatcher(existingId)
    degradedWatcherRoots.delete(existingId)
    roots.delete(existingId)
    database().query('DELETE FROM roots WHERE root_id = ?').run(existingId)
    database().query('DELETE FROM crawl_queue WHERE root_id = ?').run(existingId)
  }

  for (const root of normalized) {
    const existing = rootRow(root.id)
    const pathChanged = !!existing && path.resolve(existing.root_path) !== path.resolve(root.path)
    roots.set(root.id, root)
    if (!existing) {
      upsertRoot(root)
      rebuild.push(root.id)
    } else if (pathChanged) {
      closeWatcher(root.id)
      degradedWatcherRoots.delete(root.id)
      database().query('DELETE FROM entries WHERE root_id = ?').run(root.id)
      database().query('DELETE FROM crawl_queue WHERE root_id = ?').run(root.id)
      database()
        .query(
          `UPDATE roots SET name=?, root_path=?, source=?, state='building', generation=0,
           indexed_entries=0, scanned_directories=0, last_complete_at=NULL, error=NULL,
           root_mtime=NULL, root_birthtime=NULL, refresh_mode='polling' WHERE root_id=?`,
        )
        .run(root.name, root.path, root.source, root.id)
      rebuild.push(root.id)
    } else {
      upsertRoot(root, existing.state)
    }
  }
  refreshWatchers()
  return rebuild
}

type IndexedEntry = {
  relativePath: string
  parentPath: string
  name: string
  isDirectory: boolean
  extension: string
  mediaType: MediaType
  generation: number
  seenToken: number
  queueDirectory?: boolean
}

const upsertEntry = () =>
  database().query(`
    INSERT INTO entries(
      root_id, relative_path, parent_path, name, name_key, path_key,
      is_directory, extension, media_type, directory_mtime, directory_birthtime, generation, seen_token
    ) VALUES (
      $rootId, $relativePath, $parentPath, $name, $nameKey, $pathKey,
      $isDirectory, $extension, $mediaType, NULL, NULL, $generation, $seenToken
    )
    ON CONFLICT(root_id, relative_path) DO UPDATE SET
      parent_path=excluded.parent_path,
      name=excluded.name,
      name_key=excluded.name_key,
      path_key=excluded.path_key,
      is_directory=excluded.is_directory,
      extension=excluded.extension,
      media_type=excluded.media_type,
      directory_mtime=CASE
        WHEN excluded.is_directory = 1 AND entries.is_directory = 1 THEN entries.directory_mtime
        ELSE NULL
      END,
      directory_birthtime=CASE
        WHEN excluded.is_directory = 1 AND entries.is_directory = 1 THEN entries.directory_birthtime
        ELSE NULL
      END,
      generation=excluded.generation,
      seen_token=excluded.seen_token
  `)

function writeEntryBatch(rootId: string, entries: IndexedEntry[]) {
  if (entries.length === 0) return
  const statement = upsertEntry()
  const insertQueue = database().query(
    'INSERT OR IGNORE INTO crawl_queue(root_id, relative_path, generation) VALUES (?, ?, ?)',
  )
  database().transaction((batch: IndexedEntry[]) => {
    for (const entry of batch) {
      statement.run({
        rootId,
        relativePath: entry.relativePath,
        parentPath: entry.parentPath,
        name: entry.name,
        nameKey: normalizeFileSearchText(entry.name),
        pathKey: normalizeFileSearchText(entry.relativePath),
        isDirectory: entry.isDirectory ? 1 : 0,
        extension: entry.extension,
        mediaType: entry.mediaType,
        generation: entry.generation,
        seenToken: entry.seenToken,
      })
      if (entry.isDirectory && entry.queueDirectory !== false) {
        insertQueue.run(rootId, entry.relativePath, entry.generation)
      }
    }
  })(entries)
}

async function classifyDirent(
  root: SearchRoot,
  directory: string,
  entry: import('node:fs').Dirent,
): Promise<{ isDirectory: boolean; isFile: boolean }> {
  if (entry.isSymbolicLink()) return { isDirectory: false, isFile: false }
  if (entry.isDirectory()) return { isDirectory: true, isFile: false }
  if (entry.isFile()) return { isDirectory: false, isFile: true }
  try {
    const info = await stat(path.join(root.path, directory, entry.name))
    return { isDirectory: info.isDirectory(), isFile: info.isFile() }
  } catch {
    return { isDirectory: false, isFile: false }
  }
}

async function processDirectory(root: SearchRoot, relativeDir: string, generation: number) {
  const absoluteDir = path.join(root.path, relativeDir.replace(/\//g, path.sep))
  const info = await stat(absoluteDir)
  if (!info.isDirectory()) throw new Error('Path is not a directory')
  if (relativeDir) {
    database()
      .query(
        'UPDATE entries SET directory_mtime=?, directory_birthtime=? WHERE root_id=? AND relative_path=?',
      )
      .run(info.mtimeMs, info.birthtimeMs, root.id, relativeDir)
  } else {
    database()
      .query('UPDATE roots SET root_mtime=?, root_birthtime=? WHERE root_id=?')
      .run(info.mtimeMs, info.birthtimeMs, root.id)
  }

  const directory = await opendir(absoluteDir, { bufferSize: 128 })
  let batch: IndexedEntry[] = []
  for await (const entry of directory) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    const kind = await classifyDirent(root, relativeDir, entry)
    if (!kind.isDirectory && !kind.isFile) continue
    if (shouldIgnoreRelative(relativePath, kind.isDirectory)) continue
    const extension = kind.isDirectory ? '' : path.extname(entry.name).slice(1).toLowerCase()
    batch.push({
      relativePath,
      parentPath: relativeDir,
      name: entry.name,
      isDirectory: kind.isDirectory,
      extension,
      mediaType: kind.isDirectory ? MediaType.FOLDER : getMediaType(extension),
      generation,
      seenToken: 0,
    })
    if (batch.length >= ENTRY_BATCH_SIZE) {
      writeEntryBatch(root.id, batch)
      batch = []
      await Promise.resolve()
    }
  }
  writeEntryBatch(root.id, batch)
  database()
    .query('UPDATE roots SET scanned_directories=scanned_directories+1 WHERE root_id=?')
    .run(root.id)
}

async function drainCrawlQueue(root: SearchRoot, generation: number): Promise<boolean> {
  let complete = true
  while (!closed) {
    const queued = database()
      .query(
        'SELECT relative_path FROM crawl_queue WHERE root_id=? AND generation=? ORDER BY rowid LIMIT 1',
      )
      .get(root.id, generation) as { relative_path: string } | null
    if (!queued) break
    try {
      await processDirectory(root, queued.relative_path, generation)
    } catch (error) {
      complete = false
      database()
        .query("UPDATE roots SET state='partial', error=? WHERE root_id=?")
        .run(errorMessage(error), root.id)
    } finally {
      database()
        .query('DELETE FROM crawl_queue WHERE root_id=? AND relative_path=?')
        .run(root.id, queued.relative_path)
    }
  }
  return complete
}

async function fullScanRoot(rootId: string) {
  const root = roots.get(rootId)
  if (!root) return
  closeWatcher(rootId)
  const existing = rootRow(rootId)
  const generation = (existing?.generation ?? 0) + 1
  database().query('DELETE FROM crawl_queue WHERE root_id=?').run(rootId)
  database()
    .query(
      `UPDATE roots SET state='building', generation=?, scanned_directories=0, error=NULL,
       refresh_mode='polling' WHERE root_id=?`,
    )
    .run(generation, rootId)
  try {
    const rootInfo = await stat(root.path)
    if (!rootInfo.isDirectory()) throw new Error('Media root is not a directory')
    database()
      .query('INSERT INTO crawl_queue(root_id, relative_path, generation) VALUES (?, ?, ?)')
      .run(rootId, '', generation)
    const complete = await drainCrawlQueue(root, generation)
    if (complete) {
      database()
        .query('DELETE FROM entries WHERE root_id=? AND generation<>?')
        .run(rootId, generation)
    }
    const count = Number(
      (
        database().query('SELECT count(*) AS count FROM entries WHERE root_id=?').get(rootId) as {
          count: number
        }
      ).count,
    )
    database()
      .query(
        `UPDATE roots SET state=?, indexed_entries=?, last_complete_at=?, error=? WHERE root_id=?`,
      )
      .run(
        complete ? 'ready' : 'partial',
        count,
        complete ? Date.now() : (existing?.last_complete_at ?? null),
        complete ? null : 'Some directories could not be read',
        rootId,
      )
    if (complete) {
      database().run('PRAGMA optimize')
      checkpointDatabase(true)
    }
  } catch (error) {
    database()
      .query("UPDATE roots SET state='offline', error=?, refresh_mode='degraded' WHERE root_id=?")
      .run(errorMessage(error), rootId)
  } finally {
    refreshWatchers()
  }
}

function deleteSubtree(rootId: string, relativePath: string) {
  if (!relativePath) return
  database()
    .query('DELETE FROM entries WHERE root_id=? AND (relative_path=? OR relative_path GLOB ?)')
    .run(rootId, relativePath, `${globEscape(relativePath)}/*`)
}

async function rescanDirectory(rootId: string, relativeDir: string) {
  const root = roots.get(rootId)
  const row = rootRow(rootId)
  if (!root || !row) return
  const token = ++targetToken
  const generation = row.generation || 1
  const absoluteDir = path.join(root.path, relativeDir.replace(/\//g, path.sep))
  try {
    const info = await stat(absoluteDir)
    if (!info.isDirectory()) throw new Error('Path is not a directory')
    if (relativeDir) {
      database()
        .query(
          'UPDATE entries SET directory_mtime=?, directory_birthtime=? WHERE root_id=? AND relative_path=?',
        )
        .run(info.mtimeMs, info.birthtimeMs, rootId, relativeDir)
    } else {
      database()
        .query('UPDATE roots SET root_mtime=?, root_birthtime=? WHERE root_id=?')
        .run(info.mtimeMs, info.birthtimeMs, rootId)
    }

    const directory = await opendir(absoluteDir, { bufferSize: 128 })
    let batch: IndexedEntry[] = []
    for await (const entry of directory) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      const kind = await classifyDirent(root, relativeDir, entry)
      if (!kind.isDirectory && !kind.isFile) continue
      if (shouldIgnoreRelative(relativePath, kind.isDirectory)) continue
      const extension = kind.isDirectory ? '' : path.extname(entry.name).slice(1).toLowerCase()
      batch.push({
        relativePath,
        parentPath: relativeDir,
        name: entry.name,
        isDirectory: kind.isDirectory,
        extension,
        mediaType: kind.isDirectory ? MediaType.FOLDER : getMediaType(extension),
        generation,
        seenToken: token,
        queueDirectory:
          !kind.isDirectory ||
          !database()
            .query(
              'SELECT 1 AS found FROM entries WHERE root_id=? AND relative_path=? AND is_directory=1',
            )
            .get(rootId, relativePath),
      })
      if (batch.length >= ENTRY_BATCH_SIZE) {
        writeEntryBatch(rootId, batch)
        batch = []
      }
    }
    writeEntryBatch(rootId, batch)

    while (true) {
      const staleDirectories = database()
        .query(
          `SELECT relative_path FROM entries
           WHERE root_id=? AND parent_path=? AND seen_token<>? AND is_directory=1
           LIMIT 256`,
        )
        .all(rootId, relativeDir, token) as { relative_path: string }[]
      if (staleDirectories.length === 0) break
      for (const entry of staleDirectories) deleteSubtree(rootId, entry.relative_path)
    }
    database()
      .query(
        `DELETE FROM entries
         WHERE root_id=? AND parent_path=? AND seen_token<>? AND is_directory=0`,
      )
      .run(rootId, relativeDir, token)
    const complete = await drainCrawlQueue(root, generation)
    const count = Number(
      (
        database().query('SELECT count(*) AS count FROM entries WHERE root_id=?').get(rootId) as {
          count: number
        }
      ).count,
    )
    database()
      .query('UPDATE roots SET state=?, indexed_entries=?, error=? WHERE root_id=?')
      .run(
        complete ? 'ready' : 'partial',
        count,
        complete ? null : 'Some directories could not be read',
        rootId,
      )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (relativeDir && (code === 'ENOENT' || code === 'ENOTDIR')) {
      deleteSubtree(rootId, relativeDir)
      enqueueDirectory(rootId, parentRelative(relativeDir))
    } else if (!relativeDir && (code === 'ENOENT' || code === 'ENOTDIR')) {
      closeWatcher(rootId)
      database()
        .query("UPDATE roots SET state='offline', refresh_mode='degraded', error=? WHERE root_id=?")
        .run(errorMessage(error), rootId)
    } else {
      database()
        .query("UPDATE roots SET state='partial', error=? WHERE root_id=?")
        .run(errorMessage(error), rootId)
    }
  }
}

function enqueueDirectory(rootId: string, directory: string) {
  const normalized = normalizeRelative(directory)
  if (collapsedRoots.has(rootId)) return
  let set = pendingDirectories.get(rootId)
  if (!set) {
    set = new Set()
    pendingDirectories.set(rootId, set)
  }
  if (set.has(normalized)) return
  if (pendingDirectoryCount >= MAX_PENDING_DIRECTORIES) {
    pendingDirectoryCount -= set.size
    set.clear()
    collapsedRoots.add(rootId)
    return
  }
  set.add(normalized)
  pendingDirectoryCount++
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = undefined
    void enqueueWork(flushPendingDirectories)
  }, WATCH_DEBOUNCE_MS)
}

async function flushPendingDirectories() {
  const collapsed = [...collapsedRoots]
  collapsedRoots.clear()
  const pending = [...pendingDirectories.entries()].map(
    ([rootId, values]) => [rootId, [...values]] as const,
  )
  pendingDirectories.clear()
  pendingDirectoryCount = 0
  for (const rootId of collapsed) await reconcileRoot(rootId)
  for (const [rootId, directories] of pending) {
    for (const directory of directories) await rescanDirectory(rootId, directory)
  }
}

function watcherEligible(root: SearchRoot, enforceCap = true): boolean {
  if (!config) return false
  return isRecursiveWatchEligible({
    platform: process.platform,
    watchMode: config.watchMode,
    rootPath: root.path,
    watcherCount: enforceCap ? watchers.size : 0,
    maxRecursiveWatchers: enforceCap ? config.maxRecursiveWatchers : 1,
  })
}

function closeWatcher(rootId: string) {
  const watcher = watchers.get(rootId)
  if (!watcher) return
  watchers.delete(rootId)
  watcher.close()
}

function watcherFailed(rootId: string, error: unknown) {
  closeWatcher(rootId)
  degradedWatcherRoots.add(rootId)
  if (db) {
    database()
      .query("UPDATE roots SET refresh_mode='degraded', error=? WHERE root_id=?")
      .run(errorMessage(error), rootId)
  }
  collapsedRoots.add(rootId)
  void enqueueWork(flushPendingDirectories)
}

function refreshWatchers() {
  if (!config || !db) return
  for (const [rootId, watcher] of watchers) {
    const root = roots.get(rootId)
    if (!root || !watcherEligible(root, false)) {
      closeWatcher(rootId)
    }
  }
  for (const root of roots.values()) {
    if (watchers.size >= config.maxRecursiveWatchers) break
    if (watchers.has(root.id) || !watcherEligible(root)) continue
    const row = rootRow(root.id)
    if (!row || row.state === 'offline' || row.state === 'building') continue
    try {
      const watcher = watch(
        root.path,
        { recursive: true, persistent: false },
        (event, filename) => {
          if (event !== 'rename') return
          if (filename === null || filename === undefined) {
            watcherFailed(root.id, 'Watcher event did not include a filename')
            return
          }
          const relative = normalizeRelative(String(filename))
          if (shouldIgnoreRelative(relative, false)) return
          enqueueDirectory(root.id, parentRelative(relative))
        },
      )
      watcher.on('error', (error) => watcherFailed(root.id, error))
      watcher.on('close', () => {
        if (watchers.get(root.id) === watcher) watcherFailed(root.id, 'Watcher closed')
      })
      watchers.set(root.id, watcher)
      degradedWatcherRoots.delete(root.id)
      database()
        .query("UPDATE roots SET refresh_mode='recursive-watch' WHERE root_id=?")
        .run(root.id)
    } catch (error) {
      watcherFailed(root.id, error)
    }
  }
  for (const root of roots.values()) {
    if (watchers.has(root.id)) continue
    const row = rootRow(root.id)
    if (!row || row.state === 'offline' || row.state === 'building') continue
    database()
      .query('UPDATE roots SET refresh_mode=? WHERE root_id=?')
      .run(degradedWatcherRoots.has(root.id) ? 'degraded' : 'polling', root.id)
  }
}

async function reconcileRoot(rootId: string) {
  const root = roots.get(rootId)
  const row = rootRow(rootId)
  if (!root || !row) return
  database().query("UPDATE roots SET state='refreshing' WHERE root_id=?").run(rootId)
  try {
    const rootInfo = await stat(root.path)
    if (row.root_birthtime === null || rootInfo.birthtimeMs !== row.root_birthtime) {
      await fullScanRoot(rootId)
      return
    }
    if (row.root_mtime === null || rootInfo.mtimeMs !== row.root_mtime) {
      await rescanDirectory(rootId, '')
    }
  } catch (error) {
    database()
      .query("UPDATE roots SET state='offline', refresh_mode='degraded', error=? WHERE root_id=?")
      .run(errorMessage(error), rootId)
    closeWatcher(rootId)
    return
  }

  let cursor = 0
  const rate = config?.reconcileDirectoriesPerSecond ?? 128
  const concurrency = config?.maxFsConcurrency ?? 4
  while (!closed) {
    const directories = database()
      .query(
        `SELECT id, relative_path, directory_mtime, directory_birthtime FROM entries
         WHERE root_id=? AND is_directory=1 AND id>? ORDER BY id LIMIT ?`,
      )
      .all(rootId, cursor, rate) as {
      id: number
      relative_path: string
      directory_mtime: number | null
      directory_birthtime: number | null
    }[]
    if (directories.length === 0) break
    cursor = directories.at(-1)!.id
    for (let i = 0; i < directories.length; i += concurrency) {
      const slice = directories.slice(i, i + concurrency)
      await Promise.all(
        slice.map(async (directory) => {
          try {
            const info = await stat(
              path.join(root.path, directory.relative_path.replace(/\//g, path.sep)),
            )
            if (
              directory.directory_mtime === null ||
              info.mtimeMs !== directory.directory_mtime ||
              directory.directory_birthtime === null ||
              info.birthtimeMs !== directory.directory_birthtime
            ) {
              enqueueDirectory(rootId, directory.relative_path)
            }
          } catch {
            enqueueDirectory(rootId, parentRelative(directory.relative_path))
          }
        }),
      )
    }
    await flushPendingDirectories()
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  const latest = rootRow(rootId)
  if (latest?.state === 'refreshing') {
    database().query("UPDATE roots SET state='ready', error=NULL WHERE root_id=?").run(rootId)
  }
  refreshWatchers()
}

async function reconcileAll(rootId?: string) {
  const ids = rootId ? [rootId] : [...roots.keys()]
  for (const id of ids) await reconcileRoot(id)
  checkpointDatabase()
}

async function reconciliationLoop() {
  while (!closed) {
    await enqueueWork(() => reconcileAll())
    const degraded = db
      ? Number(
          (
            database()
              .query(
                "SELECT count(*) AS count FROM roots WHERE state IN ('offline', 'partial', 'error')",
              )
              .get() as { count: number }
          ).count,
        ) > 0
      : true
    await new Promise((resolve) => setTimeout(resolve, degraded ? 3_000 : 60_000))
  }
}

function buildStatus(): FileSearchStatus {
  if (!config?.enabled) {
    return {
      state: 'disabled',
      stale: false,
      indexedEntries: 0,
      scannedDirectories: 0,
      watcherCount: 0,
      roots: [],
    }
  }
  if (!db) {
    return {
      state: 'error',
      stale: true,
      indexedEntries: 0,
      scannedDirectories: 0,
      watcherCount: 0,
      roots: [],
      error: disabledError ?? 'File search is starting',
    }
  }
  const rows = database().query('SELECT * FROM roots ORDER BY name').all() as RootRow[]
  const rootStatuses = rows.map((row) => ({
    id: row.root_id,
    name: row.name,
    state: row.state,
    refreshMode: row.refresh_mode,
    indexedEntries: Number(row.indexed_entries),
    scannedDirectories: Number(row.scanned_directories),
    lastCompleteAt: row.last_complete_at === null ? null : Number(row.last_complete_at),
    ...(row.error ? { error: row.error } : {}),
  }))
  const states = new Set(rootStatuses.map((root) => root.state))
  const state = states.has('building')
    ? 'building'
    : states.has('refreshing')
      ? 'refreshing'
      : states.has('partial') || states.has('offline')
        ? 'partial'
        : states.has('error')
          ? 'error'
          : 'ready'
  return {
    state,
    stale: state !== 'ready',
    indexedEntries: rootStatuses.reduce((sum, root) => sum + root.indexedEntries, 0),
    scannedDirectories: rootStatuses.reduce((sum, root) => sum + root.scannedDirectories, 0),
    watcherCount: watchers.size,
    roots: rootStatuses,
  }
}

function scoreResult(result: FileSearchResult, query: string): number {
  const name = normalizeFileSearchText(result.name)
  const fullPath = normalizeFileSearchText(result.path)
  if (name === query) return 0
  if (name.startsWith(query)) return 10 + name.length / 10_000
  const boundary = name.search(
    new RegExp(`(^|[\\s._-])${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  )
  if (boundary >= 0) return 20 + boundary / 1_000
  if (name.includes(query)) return 30 + name.indexOf(query) / 1_000
  return 40 + fullPath.indexOf(query) / 1_000 + fullPath.length / 100_000
}

function search(queryRaw: string, limit: number): FileSearchResponse {
  const query = normalizeFileSearchText(queryRaw)
  const phrase = `"${query.replaceAll('"', '""')}"`
  const rows = database()
    .query(
      `SELECT e.* FROM entries_fts
       JOIN entries e ON e.id=entries_fts.rowid
       JOIN roots r ON r.root_id=e.root_id
       WHERE entries_fts MATCH ? AND r.state<>'offline'
       ORDER BY bm25(entries_fts, 10.0, 1.0)
       LIMIT ?`,
    )
    .all(phrase, SEARCH_CANDIDATE_LIMIT) as EntryRow[]

  const results: FileSearchResult[] = []
  for (const row of rows) {
    const root = roots.get(row.root_id)
    if (!root) continue
    results.push({
      name: row.name,
      path: logicalPath(root, row.relative_path),
      parentPath: logicalPath(root, row.parent_path),
      rootId: root.id,
      rootName: root.name,
      isDirectory: row.is_directory === 1,
      extension: row.extension,
      type: row.is_directory === 1 ? MediaType.FOLDER : (row.media_type as MediaType),
    })
  }
  for (const [rootId, root] of roots) {
    const row = rootRow(rootId)
    if (row?.state === 'offline') continue
    if (!normalizeFileSearchText(root.name).includes(query)) continue
    results.push({
      name: root.name,
      path: logicalPath(root, ''),
      parentPath: '',
      rootId,
      rootName: root.name,
      isDirectory: true,
      extension: '',
      type: MediaType.FOLDER,
    })
  }
  const deduped = [
    ...new Map(results.map((result) => [`${result.rootId}:${result.path}`, result])).values(),
  ]
  deduped.sort(
    (a, b) =>
      scoreResult(a, query) - scoreResult(b, query) ||
      a.path.length - b.path.length ||
      a.path.localeCompare(b.path, undefined, { numeric: true }),
  )
  return {
    results: deduped.slice(0, limit),
    truncated: rows.length >= SEARCH_CANDIDATE_LIMIT || deduped.length > limit,
    status: buildStatus(),
  }
}

async function initialize(nextConfig: WorkerConfig, initialRoots: SearchRoot[]) {
  config = nextConfig
  if (!config.enabled) return buildStatus()
  await mkdir(path.dirname(config.indexPath), { recursive: true })
  try {
    db = openDatabase(config.indexPath)
  } catch (firstError) {
    try {
      await Promise.all(
        [config.indexPath, `${config.indexPath}-wal`, `${config.indexPath}-shm`].map((file) =>
          rm(file, { force: true }),
        ),
      )
      db = openDatabase(config.indexPath)
    } catch (error) {
      disabledError = `Failed to initialize file search index: ${errorMessage(error)}`
      console.error('[File search] Index recovery failed after:', firstError)
      throw error
    }
  }
  const rebuild = await syncRoots(initialRoots)
  for (const rootId of rebuild) void enqueueWork(() => fullScanRoot(rootId))
  for (const rootId of roots.keys()) {
    if (!rebuild.includes(rootId)) void enqueueWork(() => reconcileRoot(rootId))
  }
  void reconciliationLoop()
  return buildStatus()
}

globalThis.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  void (async () => {
    try {
      switch (request.type) {
        case 'init':
          post({ id: request.id, ok: true, data: await initialize(request.config, request.roots) })
          break
        case 'search':
          post({ id: request.id, ok: true, data: search(request.query, request.limit) })
          break
        case 'status':
          post({ id: request.id, ok: true, data: buildStatus() })
          break
        case 'sync-roots': {
          const rebuild = await syncRoots(request.roots)
          for (const rootId of rebuild) void enqueueWork(() => fullScanRoot(rootId))
          post({ id: request.id, ok: true, data: buildStatus() })
          break
        }
        case 'file-change':
          enqueueDirectoryForLogicalPath(request.directory)
          post({ id: request.id, ok: true, data: { accepted: true } })
          break
        case 'reindex':
          if (request.rootId && !roots.has(request.rootId)) {
            throw new Error(`Unknown file search root: ${request.rootId}`)
          }
          if (request.mode === 'full') {
            const ids = request.rootId ? [request.rootId] : [...roots.keys()]
            for (const rootId of ids) void enqueueWork(() => fullScanRoot(rootId))
          } else {
            void enqueueWork(() => reconcileAll(request.rootId))
          }
          post({ id: request.id, ok: true, data: { accepted: true } })
          break
        case 'shutdown':
          closed = true
          if (pendingTimer) clearTimeout(pendingTimer)
          for (const watcher of watchers.values()) watcher.close()
          watchers.clear()
          if (db) {
            try {
              db.run('PRAGMA wal_checkpoint(TRUNCATE)')
            } catch {}
            db.close()
            db = null
          }
          post({ id: request.id, ok: true, data: { stopped: true } })
          break
      }
    } catch (error) {
      post({ id: request.id, ok: false, error: errorMessage(error) })
    }
  })()
}

function enqueueDirectoryForLogicalPath(logicalDirectory: string) {
  const normalized = normalizeRelative(logicalDirectory)
  if (roots.size <= 1) {
    const root = roots.values().next().value as SearchRoot | undefined
    if (root) enqueueDirectory(root.id, normalized)
    return
  }
  const [rootName = '', ...rest] = normalized.split('/')
  const root = [...roots.values()].find(
    (candidate) => candidate.name.toLowerCase() === rootName.toLowerCase(),
  )
  if (root) enqueueDirectory(root.id, rest.join('/'))
}
