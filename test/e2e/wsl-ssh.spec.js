// Optional high-fidelity integration test against a REAL OpenSSH server.
// Skips automatically unless an sshd is reachable on 127.0.0.1:2222 with
// root/testpass123 (e.g. the WSL sshd used during local development).
// Start it with:
//   wsl -u root -d Ubuntu-24.04 -- bash -lc \
//     "mkdir -p /run/sshd; echo 'root:testpass123' | chpasswd; \
//      exec /usr/sbin/sshd -D -p 2222 -o PermitRootLogin=yes -o PasswordAuthentication=yes -o UsePAM=no"
const { test, expect } = require('@playwright/test');
const net = require('net');
const { launchApp } = require('./helpers');

const HOST = '127.0.0.1', PORT = 2222, USER = 'root', PASS = 'testpass123';

function reachable() {
  return new Promise(res => {
    const s = net.connect(PORT, HOST);
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
    s.setTimeout(1500, () => { s.destroy(); res(false); });
  });
}

test('real sshd: connection goes online and SFTP lists the filesystem', async () => {
  test.skip(!(await reachable()), 'No sshd on 127.0.0.1:2222 (see file header to start WSL sshd)');
  const { app, win } = await launchApp();
  try {
    await win.click('[data-action="open-modal-new"]');
    await win.fill('#m-name', 'WSL');
    await win.fill('#m-host', HOST);
    await win.fill('#m-port', String(PORT));
    await win.fill('#m-user', USER);
    await win.fill('#m-pass', PASS);
    await win.click('[data-action="save-conn"]');

    await win.locator('.conn-item', { hasText: 'WSL' }).dblclick();
    await expect(win.locator('.conn-item .status-dot.online')).toBeVisible({ timeout: 15000 });

    await win.click('[data-action="switch-tab-type"][data-tab-type="sftp"]');
    await expect(win.locator('#file-list')).toContainText('etc', { timeout: 15000 });
    await expect(win.locator('#file-list')).toContainText('usr');
  } finally { await app.close(); }
});
