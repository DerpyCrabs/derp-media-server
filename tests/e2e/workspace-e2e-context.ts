import { devices, type Browser } from '@playwright/test'

/** Workspace origin on the shared app listener (batch-aware). */
export function workspaceE2EOrigin(): string {
  const batchId = process.env.BATCH_ID
  const port = batchId ? 9200 + parseInt(batchId, 10) : 5973
  return `http://localhost:${port}`
}

/** Shared desktop context with clipboard access for workspace tests. */
export async function createWorkspaceE2EContext(browser: Browser) {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: workspaceE2EOrigin(),
  })
  return context
}
