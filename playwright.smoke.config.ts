import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3001'
const shouldStartLocalServer = baseURL.includes('localhost')

export default defineConfig({
  testDir: './tests/smoke',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'output/playwright/smoke/html-report', open: 'never' }]],
  outputDir: 'output/playwright/smoke/results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: shouldStartLocalServer
    ? {
        command: 'npm --workspace admin-dashboard run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
})
