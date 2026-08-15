import { defineConfig, devices } from '@playwright/test'
import path from 'path'

process.env.NO_PROXY =
  (process.env.NO_PROXY ? process.env.NO_PROXY + ',' : '') + 'localhost,127.0.0.1'

const batchId = process.env.BATCH_ID
const port = batchId ? 9200 + parseInt(batchId) : 5973
const configFile = batchId
  ? `tests/fixtures/test-config-${batchId}.jsonc`
  : 'tests/fixtures/test-config.jsonc'
const outputDir = batchId ? `test-results/batch-${batchId}` : 'test-results'
const htmlReportDir = batchId ? `playwright-report/batch-${batchId}` : 'playwright-report'
const serverTargetDir = process.env.TEST_SERVER_TARGET_DIR ?? 'target'
const serverBinary = path.resolve(
  __dirname,
  serverTargetDir,
  'release',
  process.platform === 'win32' ? 'derp-media-server.exe' : 'derp-media-server',
)
const releaseServer = `"${serverBinary}" --production`
const seededReleaseServer = `bun tests/fixtures/seed-state.ts && ${releaseServer}`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Batch runner parallelizes isolated servers; keep each server on one browser worker.
  workers: 1,
  reporter: [['line'], ['html', { open: 'never', outputFolder: htmlReportDir }]],
  timeout: 15_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: './tests/fixtures/setup.ts',
  globalTeardown: './tests/fixtures/teardown.ts',
  webServer: {
    command: seededReleaseServer,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      CONFIG_PATH: configFile,
      NO_PROXY: 'localhost,127.0.0.1',
      // Bun's global transpiler cache can crash when all six batch servers compile concurrently.
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
    },
  },
})
