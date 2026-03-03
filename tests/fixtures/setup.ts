import type { FullConfig } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { scryptSync, createCipheriv, randomBytes } from 'crypto'
import { generateTestMedia } from './generate-media'

const TEST_MEDIA_DIR = path.resolve('test-media')
const MEDIA_DIR_KEY = 'test-media'

function encryptPasscode(passcode: string): string {
  const key = scryptSync('test-password', 'derp-media-server-passcode-v1', 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(passcode, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url')
}

function mergeJsonFile(filePath: string, data: Record<string, unknown>) {
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    // file doesn't exist yet
  }
  Object.assign(existing, data)
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2))
}

export default async function setup(_config: FullConfig) {
  console.log('[e2e] Setting up test fixtures...')

  if (fs.existsSync(TEST_MEDIA_DIR)) {
    fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true })
  }

  generateTestMedia(TEST_MEDIA_DIR)

  mergeJsonFile(path.resolve('settings.json'), {
    [MEDIA_DIR_KEY]: {
      viewModes: {},
      favorites: [],
      knowledgeBases: ['Notes'],
      customIcons: {},
      autoSave: {},
    },
  })

  mergeJsonFile(path.resolve('shares.json'), {
    [MEDIA_DIR_KEY]: {
      shares: [
        {
          token: 'test-passcode-share-token1',
          path: 'SharedContent',
          isDirectory: true,
          editable: false,
          passcode: encryptPasscode('secret123'),
          createdAt: Date.now(),
        },
      ],
    },
  })

  mergeJsonFile(path.resolve('stats.json'), {
    [MEDIA_DIR_KEY]: { views: {}, shareViews: {} },
  })

  console.log('[e2e] Test fixtures ready.')
}
