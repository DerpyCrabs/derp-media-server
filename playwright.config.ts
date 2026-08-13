import { defineConfig, devices } from '@playwright/test'
import path from 'path'

process.env.NO_PROXY =
  (process.env.NO_PROXY ? process.env.NO_PROXY + ',' : '') + 'localhost,127.0.0.1'

const batchId = process.env.BATCH_ID
const port = batchId ? 9200 + parseInt(batchId) : 5973
const configFile = batchId
  ? `tests/fixtures/test-config-${batchId}.jsonc`
  : 'tests/fixtures/test-config.jsonc'
const authSessionFile = batchId ? `session-${batchId}.json` : 'session.json'
const authStoragePath = path.join(__dirname, 'tests/fixtures/.auth', authSessionFile)
const outputDir = batchId ? `test-results/batch-${batchId}` : 'test-results'
const htmlReportDir = batchId ? `playwright-report/batch-${batchId}` : 'playwright-report'
const releaseServer =
  process.platform === 'win32'
    ? 'target\\release\\derp-media-server.exe --production'
    : 'target/release/derp-media-server --production'
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
      name: 'auth-setup',
      testDir: './tests/fixtures',
      testMatch: /auth-setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'login',
      testMatch: /login\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStoragePath,
      },
      dependencies: ['auth-setup'],
      testIgnore: /login\.spec\.ts/,
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
