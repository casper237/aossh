const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,                 // one Electron instance at a time
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list']],
});
