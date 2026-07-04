// Semver-ish comparison used by the "update available" check.
// Returns true if `latest` is strictly newer than `current`.
function isNewerVersion(current, latest) {
  const parse = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
  const a = parse(current), b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((b[i] || 0) > (a[i] || 0)) return true;
    if ((b[i] || 0) < (a[i] || 0)) return false;
  }
  return false;
}

module.exports = { isNewerVersion };
