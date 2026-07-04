const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

test('create a connection — it appears in the sidebar', async () => {
  const { app, win } = await launchApp();
  try {
    await win.click('[data-action="open-modal-new"]');
    await win.fill('#m-name', 'Test Server');
    await win.fill('#m-host', '10.0.0.99');
    await win.fill('#m-user', 'root');
    await win.click('[data-action="save-conn"]');
    await expect(win.locator('#conn-list')).toContainText('Test Server');
    await expect(win.locator('#conn-list')).toContainText('root@10.0.0.99');
  } finally { await app.close(); }
});

test('edit a connection — changes persist in the sidebar', async () => {
  const { app, win } = await launchApp();
  try {
    await win.click('[data-action="open-modal-new"]');
    await win.fill('#m-name', 'Before');
    await win.fill('#m-host', '1.1.1.1');
    await win.fill('#m-user', 'root');
    await win.click('[data-action="save-conn"]');
    await win.locator('.conn-item', { hasText: 'Before' }).click({ button: 'right' });
    await win.click('[data-action="ctx-edit"]');
    await win.fill('#m-name', 'After');
    await win.click('[data-action="save-conn"]');
    await expect(win.locator('#conn-list')).toContainText('After');
    await expect(win.locator('#conn-list')).not.toContainText('Before');
  } finally { await app.close(); }
});

test('double-click a connection opens a terminal tab (double-click regression)', async () => {
  const { app, win } = await launchApp();
  try {
    await win.click('[data-action="open-modal-new"]');
    await win.fill('#m-name', 'DblSrv');
    await win.fill('#m-host', '10.0.0.98');
    await win.fill('#m-user', 'root');
    await win.click('[data-action="save-conn"]');
    await win.locator('.conn-item', { hasText: 'DblSrv' }).dblclick();
    await expect(win.locator('#tabs-container .tab')).toContainText('DblSrv');
  } finally { await app.close(); }
});

test('master password: enable, then require + verify it on relaunch', async () => {
  const first = await launchApp();
  try {
    await first.win.click('[data-action="open-modal-new"]');
    await first.win.fill('#m-name', 'Vaulted');
    await first.win.fill('#m-host', '10.0.0.50');
    await first.win.fill('#m-user', 'root');
    await first.win.fill('#m-pass', 'srvpass');
    await first.win.click('[data-action="save-conn"]');
    await first.win.click('[data-action="toggle-tools-menu"]');
    await first.win.click('[data-action="open-vault-settings"]');
    await first.win.fill('#vault-new', 'masterpass');
    await first.win.fill('#vault-new2', 'masterpass');
    await first.win.click('[data-action="vault-enable"]');
    await expect(first.win.locator('.toast')).toContainText('enabled');
  } finally { await first.app.close(); }

  const second = await launchApp(first.userDataDir);   // relaunch same store
  try {
    await expect(second.win.locator('#vault-pw')).toBeVisible();     // lock screen
    await second.win.fill('#vault-pw', 'wrongpass');
    await second.win.click('[data-action="vault-unlock"]');
    await expect(second.win.locator('#vault-pw')).toBeVisible();     // still locked
    await second.win.fill('#vault-pw', 'masterpass');
    await second.win.click('[data-action="vault-unlock"]');
    await expect(second.win.locator('.sidebar')).toBeVisible();      // unlocked → app renders
    await expect(second.win.locator('#conn-list')).toContainText('Vaulted');
  } finally { await second.app.close(); }
});
