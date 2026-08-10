import fs from 'fs'
import path from 'path'
import { scryptSync, createCipheriv, randomBytes } from 'crypto'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const dataDirName = batchId ? `test-data-${batchId}` : 'test-data-local'
const dataDir = path.resolve(dataDirName)

function encryptPasscode(passcode: string): string {
  const key = scryptSync('test-password', 'derp-media-server-passcode-v1', 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(passcode, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

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
  path.join(dataDir, 'shares.json'),
  JSON.stringify({
    [mediaDirName]: {
      shares: [
        {
          token: 'test-passcode-share-token1',
          path: 'SharedContent',
          isDirectory: true,
          editable: false,
          passcode: encryptPasscode('secret123'),
          createdAt: Date.now(),
        },
        {
          token: 'test-unprotected-share-token1',
          path: 'Documents/notes.md',
          isDirectory: false,
          editable: false,
          createdAt: Date.now() - 1,
        },
        {
          token: 'test-protected-file-share-token1',
          path: 'Documents/sample.pdf',
          isDirectory: false,
          editable: false,
          passcode: encryptPasscode('filepass'),
          createdAt: Date.now() - 2,
        },
        {
          token: 'test-book-share-token1',
          path: 'Documents/reader.epub',
          isDirectory: false,
          editable: false,
          createdAt: Date.now() - 3,
        },
      ],
    },
  }),
)
fs.writeFileSync(
  path.join(dataDir, 'stats.json'),
  JSON.stringify({ [mediaDirName]: { views: {}, shareViews: {} } }),
)
