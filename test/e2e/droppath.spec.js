// Guards the SFTP drag-and-drop upload path: Electron 32+ removed File.path,
// so we resolve dropped files via webUtils.getPathForFile (exposed in preload).
// This broke silently once on the Electron 28 -> 42 upgrade; keep this test.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');
const path = require('path');
const os = require('os');
const fs = require('fs');

test('getPathForFile resolves a picked file to its real absolute path', async () => {
  const tmp = path.join(os.tmpdir(), 'aossh-drop-test.txt');
  fs.writeFileSync(tmp, 'hi');
  const { app, win } = await launchApp();
  try {
    await win.evaluate(() => {
      const i = document.createElement('input');
      i.type = 'file'; i.id = '__drop';
      document.body.appendChild(i);
    });
    await win.setInputFiles('#__drop', tmp);
    const resolved = await win.evaluate(() => window.api.getPathForFile(document.getElementById('__drop').files[0]));
    expect(resolved).toContain('aossh-drop-test.txt');
    expect(path.isAbsolute(resolved)).toBe(true);
  } finally { await app.close(); }
});
