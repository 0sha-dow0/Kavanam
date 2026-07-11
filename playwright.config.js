const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './test/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
