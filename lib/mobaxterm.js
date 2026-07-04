// Parse a MobaXterm .mxtsessions file into connection objects.
// Pure (no id/status assigned — the caller adds those) so it is unit-testable.
function parseMobaXterm(text) {
  const lines = text.split(/\r?\n/);
  const connections = [];
  let currentGroup = 'Imported';
  let currentSubgroup = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Section header — look ahead for the SubRep (group\subgroup) line.
    if (line.startsWith('[Bookmarks')) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = lines[j].trim();
        if (next.startsWith('SubRep=')) {
          const subRep = next.slice(7).trim();
          if (subRep.includes('\\')) {
            const parts = subRep.split('\\');
            currentGroup = parts[0];
            currentSubgroup = parts[1] || null;
          } else {
            currentGroup = subRep || 'Imported';
            currentSubgroup = null;
          }
          break;
        }
      }
      continue;
    }

    if (line.startsWith('SubRep=') || line.startsWith('ImgNum=')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const name = line.slice(0, eqIdx).trim();
    const val  = line.slice(eqIdx + 1).trim();

    if (!val.includes('#109#')) continue;               // SSH sessions only
    const dataMatch = val.match(/#109#0%([^#]+)/);
    if (!dataMatch) continue;

    const parts    = dataMatch[1].split('%');
    const host     = parts[0] || '';
    const port     = parseInt(parts[1]) || 22;
    const username = parts[2] || 'root';
    const password = parts[3] || '';
    if (!host) continue;

    connections.push({
      name, host, port, username,
      password: password || '',
      authType: 'password',
      privateKey: null,
      group: currentGroup,
      subgroup: currentSubgroup,
    });
  }
  return connections;
}

module.exports = { parseMobaXterm };
