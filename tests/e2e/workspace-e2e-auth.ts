import path from 'path'
import { devices, type Browser } from '@playwright/test'

/** Same path as `storageState` in playwright.config.ts (batch-aware). */
export function workspaceAuthStoragePath(): string {
  const batchId = process.env.BATCH_ID
  const authSessionFile = batchId ? `session-${batchId}.json` : 'session.json'
  return path.resolve(__dirname, '../fixtures/.auth', authSessionFile)
}

/** Workspace origin from the separate test listener (batch-aware). */
export function workspaceE2EOrigin(): string {
  const batchId = process.env.BATCH_ID
  const mediaPort = batchId ? 9200 + parseInt(batchId, 10) : 5973
  const port = mediaPort + 100
  return `http://localhost:${port}`
}

/**
 * Matches chromium project `use` in playwright.config.ts (viewport, UA, storageState).
 * Grants clipboard access for tests that use `navigator.clipboard` (shared context ignores
 * `test.use({ permissions })`, which only applies to the default context).
 */
export async function createWorkspaceE2EContext(browser: Browser) {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    storageState: workspaceAuthStoragePath(),
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: workspaceE2EOrigin(),
  })
  return context
}
