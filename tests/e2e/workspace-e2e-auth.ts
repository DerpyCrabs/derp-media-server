import path from 'path'
import { devices, type Browser } from '@playwright/test'

/** Same path as `storageState` in playwright.config.ts (batch-aware). */
export function workspaceAuthStoragePath(): string {
  const batchId = process.env.BATCH_ID
  const authSessionFile = batchId ? `session-${batchId}.json` : 'session.json'
  return path.resolve(__dirname, '../fixtures/.auth', authSessionFile)
}

/** Matches chromium project `use` in playwright.config.ts (viewport, UA, storageState). */
export async function createWorkspaceE2EContext(browser: Browser) {
  return browser.newContext({
    ...devices['Desktop Chrome'],
    storageState: workspaceAuthStoragePath(),
  })
}
