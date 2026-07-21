import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { BASE_URL, PORT, STUB_PROVIDER_PORT, STUB_PROVIDER_URL } from './e2e/config'

// A throwaway data directory so the server starts with no saved connections each run.
const dataDir = mkdtempSync(join(tmpdir(), 'shirube-e2e-'))

export default defineConfig({
  testDir: './e2e',
  // Match only the specs, so the shared config/seed modules are not run as tests.
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 30_000,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // A stub OpenAI-compatible provider for the navigator test: reachable (so the
      // provider can be saved) but with no real model (so asking surfaces an error).
      command: 'node e2e/stub-provider.mjs',
      url: `${STUB_PROVIDER_URL}/models`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { STUB_PROVIDER_PORT },
    },
    {
      // The SPA must already be built into the API package (scripts/build.sh) so the
      // backend serves it on one origin.
      command: 'uv run --directory ../api shirube',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Don't pop a real browser, keep state in a throwaway dir, and store the password
        // in a plain file keyring so no OS keychain is needed (there is none in CI).
        SHIRUBE_OPEN_BROWSER: 'false',
        SHIRUBE_PORT: PORT,
        SHIRUBE_DATA_DIR: dataDir,
        PYTHON_KEYRING_BACKEND: 'keyrings.alt.file.PlaintextKeyring',
      },
    },
  ],
})
