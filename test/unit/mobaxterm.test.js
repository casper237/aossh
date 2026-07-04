const test = require('node:test');
const assert = require('node:assert');
const { parseMobaXterm } = require('../../lib/mobaxterm');

const sample = [
  '[Bookmarks]',
  'SubRep=Production',
  'ImgNum=42',
  'web1=#109#0%192.168.1.10%22%root%s3cret%',
  'db1=#109#0%192.168.1.11%2222%admin%pw%',
  '',
  '[Bookmarks_1]',
  'SubRep=Production\\Databases',
  'ImgNum=41',
  'db2=#109#0%10.0.0.5%22%postgres%pgpw%',
  'rdp1=#91#4%10.0.0.9%3389%',           // RDP (#91#) — must be skipped
].join('\r\n');

test('parses SSH sessions with group and defaults', () => {
  const conns = parseMobaXterm(sample);
  assert.strictEqual(conns.length, 3);
  const web1 = conns.find(c => c.name === 'web1');
  assert.deepStrictEqual(
    { host: web1.host, port: web1.port, username: web1.username, password: web1.password, group: web1.group, subgroup: web1.subgroup, authType: web1.authType },
    { host: '192.168.1.10', port: 22, username: 'root', password: 's3cret', group: 'Production', subgroup: null, authType: 'password' });
});

test('non-default port parsed', () => {
  assert.strictEqual(parseMobaXterm(sample).find(c => c.name === 'db1').port, 2222);
});

test('group\\subgroup split into group + subgroup', () => {
  const db2 = parseMobaXterm(sample).find(c => c.name === 'db2');
  assert.strictEqual(db2.group, 'Production');
  assert.strictEqual(db2.subgroup, 'Databases');
});

test('non-SSH sessions skipped', () => {
  assert.ok(!parseMobaXterm(sample).find(c => c.name === 'rdp1'));
});

test('empty input yields empty array', () => {
  assert.deepStrictEqual(parseMobaXterm(''), []);
});
