// Minimal in-process SSH/SFTP server for E2E tests. No external server touched.
// Accepts testuser/testpass, opens a shell (echo), and serves a fixed SFTP listing.
const { Server, utils } = require('ssh2');
const crypto = require('crypto');
const fsc = require('fs').constants;

const STATUS = utils.sftp.STATUS_CODE;

function genHostKey() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  }).privateKey;
}

function setupSftp(sftp) {
  const dirs = new Map();
  let seq = 0;
  sftp.on('REALPATH', (reqid, p) => {
    const resolved = (p === '.' || p === '') ? '/' : p;
    sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: {} }]);
  });
  sftp.on('OPENDIR', (reqid, p) => {
    const h = Buffer.from(String(seq++));
    dirs.set(h.toString(), false);
    sftp.handle(reqid, h);
  });
  sftp.on('READDIR', (reqid, handle) => {
    const key = handle.toString();
    if (dirs.get(key)) return sftp.status(reqid, STATUS.EOF);
    dirs.set(key, true);
    sftp.name(reqid, [
      { filename: 'readme.txt', longname: '-rw-r--r-- 1 u u 12 Jan 1 00:00 readme.txt',
        attrs: { mode: fsc.S_IFREG | 0o644, size: 12, atime: 0, mtime: 0 } },
      { filename: 'subdir', longname: 'drwxr-xr-x 1 u u 0 Jan 1 00:00 subdir',
        attrs: { mode: fsc.S_IFDIR | 0o755, size: 0, atime: 0, mtime: 0 } },
    ]);
  });
  const asDir = (reqid) => sftp.attrs(reqid, { mode: fsc.S_IFDIR | 0o755, size: 0, atime: 0, mtime: 0 });
  sftp.on('STAT', asDir);
  sftp.on('LSTAT', asDir);
  sftp.on('CLOSE', (reqid, handle) => { dirs.delete(handle.toString()); sftp.status(reqid, STATUS.OK); });
}

function startMockSsh() {
  return new Promise((resolve) => {
    const server = new Server({ hostKeys: [genHostKey()] }, (client) => {
      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === 'testuser' && ctx.password === 'testpass') ctx.accept();
        else if (ctx.method === 'none') ctx.reject(['password']);
        else ctx.reject();
      });
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          session.on('pty', (a) => a && a());
          session.on('shell', (a) => {
            const stream = a();
            stream.write('MOCK-SSH ready\r\n$ ');
            stream.on('data', (d) => stream.write(d));   // echo typed input
          });
          session.on('sftp', (a) => setupSftp(a()));
        });
      });
      client.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

module.exports = { startMockSsh };
