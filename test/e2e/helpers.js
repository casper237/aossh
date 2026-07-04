const { _electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');

// Launch the app against an ISOLATED user-data dir so tests never touch the
// real %APPDATA%/aossh store (no real connections, no real master password).
// Pass an existing dir to relaunch with the same state (e.g. to test the lock screen).
async function launchApp(userDataDir) {
  const udd = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'aossh-e2e-'));
  const app = await _electron.launch({
    args: [ROOT, `--user-data-dir=${udd}`],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win, userDataDir: udd };
}

module.exports = { launchApp };
