import fs from 'fs'
import path from 'path'
import { Database } from 'bun:sqlite'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const dataDirName = batchId ? `test-data-${batchId}` : 'test-data-local'
const dataDir = path.resolve(dataDirName)

fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true })
const database = new Database(path.join(dataDir, 'app.sqlite3'), { create: true })
database.exec(`
  CREATE TABLE state_schema (
    id INTEGER PRIMARY KEY CHECK(id=1),
    version INTEGER NOT NULL,
    applied_at INTEGER NOT NULL
  );
  INSERT INTO state_schema(id, version, applied_at) VALUES(1, 1, 0);
  CREATE TABLE state_documents (
    kind TEXT NOT NULL,
    library_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(kind, library_key)
  );
  CREATE TABLE reader_state (
    path TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE app_preferences (
    id INTEGER PRIMARY KEY CHECK(id=1),
    state_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)
const insertDocument = database.query(
  'INSERT INTO state_documents(kind, library_key, value_json, updated_at) VALUES(?1, ?2, ?3, 0)',
)
insertDocument.run(
  'settings.v1',
  mediaDirName,
  JSON.stringify({
    viewModes: {},
    favorites: [],
    knowledgeBases: ['Notes'],
    customIcons: {},
    autoSave: {},
    workspaceTaskbarPins: [],
    workspaceLayoutPresets: [],
  }),
)
insertDocument.run('playback-stats.v1', mediaDirName, JSON.stringify({ views: {} }))
database.close()
