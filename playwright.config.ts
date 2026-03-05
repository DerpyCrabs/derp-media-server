import { defineConfig, devices } from '@playwright/test'
import path from 'path'

process.env.NO_PROXY =
  (process.env.NO_PROXY ? process.env.NO_PROXY + ',' : '') + 'localhost,127.0.0.1'

const authStoragePath = path.join(__dirname, 'tests/fixtures/.auth/session.json')

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['line'], ['html', { open: 'never' }]],
  timeout: 10_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://localhost:5973',
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
    command: 'bun server/index.ts',
    url: 'http://localhost:5973',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      PORT: '5973',
      CONFIG_PATH: 'tests/fixtures/test-config.jsonc',
      NO_PROXY: 'localhost,127.0.0.1',
    },
  },
})
