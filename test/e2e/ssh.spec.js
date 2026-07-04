const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');
const { startMockSsh } = require('./mock-ssh');

async function addMockConnection(win, port, name = 'Mock') {
  await win.click('[data-action="open-modal-new"]');
  await win.fill('#m-name', name);
  await win.fill('#m-host', '127.0.0.1');
  await win.fill('#m-port', String(port));
  await win.fill('#m-user', 'testuser');
  await win.fill('#m-pass', 'testpass');
  await win.click('[data-action="save-conn"]');
}

test('connect to the mock SSH server → status goes online', async () => {
  const mock = await startMockSsh();
  const { app, win } = await launchApp();
  try {
    await addMockConnection(win, mock.port);
    await win.locator('.conn-item', { hasText: 'Mock' }).dblclick();
    // Successful auth + host-key pin + shell open flips the status dot to online.
    await expect(win.locator('.conn-item .status-dot.online')).toBeVisible({ timeout: 15000 });
  } finally { await app.close(); mock.close(); }
});

test('SFTP tab lists directory entries from the server', async () => {
  const mock = await startMockSsh();
  const { app, win } = await launchApp();
  try {
    await addMockConnection(win, mock.port);
    await win.locator('.conn-item', { hasText: 'Mock' }).dblclick();
    await expect(win.locator('.conn-item .status-dot.online')).toBeVisible({ timeout: 15000 });
    await win.click('[data-action="switch-tab-type"][data-tab-type="sftp"]');
    await expect(win.locator('#file-list')).toContainText('readme.txt', { timeout: 15000 });
    await expect(win.locator('#file-list')).toContainText('subdir');
  } finally { await app.close(); mock.close(); }
});

test('wrong password does not connect (stays offline)', async () => {
  const mock = await startMockSsh();
  const { app, win } = await launchApp();
  try {
    await win.click('[data-action="open-modal-new"]');
    await win.fill('#m-name', 'BadPass');
    await win.fill('#m-host', '127.0.0.1');
    await win.fill('#m-port', String(mock.port));
    await win.fill('#m-user', 'testuser');
    await win.fill('#m-pass', 'wrongpass');
    await win.click('[data-action="save-conn"]');
    await win.locator('.conn-item', { hasText: 'BadPass' }).dblclick();
    // Give it time to fail; the status dot must never become online.
    await win.waitForTimeout(3000);
    await expect(win.locator('.conn-item .status-dot.online')).toHaveCount(0);
  } finally { await app.close(); mock.close(); }
});
