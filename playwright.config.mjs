import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: true, retries: process.env.CI ? 1 : 0,
  reporter: 'list', outputDir: 'test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }
  ]
});
