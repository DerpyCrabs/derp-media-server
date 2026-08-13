import fs from 'fs'
import path from 'path'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const dataDirName = batchId ? `test-data-${batchId}` : 'test-data-local'
const dataDir = path.resolve(dataDirName)

fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true })
fs.writeFileSync(
  path.join(dataDir, 'settings.json'),
  JSON.stringify({
    [mediaDirName]: {
      viewModes: {},
      favorites: [],
      knowledgeBases: ['Notes'],
      customIcons: {},
      autoSave: {},
    },
  }),
)
fs.writeFileSync(
  path.join(dataDir, 'stats.json'),
  JSON.stringify({ [mediaDirName]: { views: {} } }),
)
