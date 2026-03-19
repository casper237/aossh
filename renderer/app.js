// ── State ─────────────────────────────────────────────────────────────────────
let connections = [];
let tabs = [];
let activeTabId = null;
let terminals = {};
let terminalPasteHandlersRegistered = false;
let selectedConnId = null;
const sftpProgressListeners = new Set();
let collapsedGroups = JSON.parse(localStorage.getItem('collapsedGroups') || '{}');
let aiPanelOpen = false;
let aiPanelWidth = 420;
let aiTabs = [];
let activeAiTabId = null;
let nextAiTabId = 1;

const AI_PRESETS = [
  { name: 'Claude',      url: 'https://claude.ai' },
  { name: 'ChatGPT',     url: 'https://chatgpt.com' },
  { name: 'Gemini',      url: 'https://gemini.google.com' },
  { name: 'Grok',        url: 'https://grok.com' },
  { name: 'Perplexity',  url: 'https://perplexity.ai' },
];

window.addEventListener('DOMContentLoaded', async () => {
  connections = await window.api.loadConnections();
  // Reset all statuses to offline on startup
  connections = connections.map(c => ({ ...c, status: 'offline' }));
  document.addEventListener('click', e => {
    // Ignore right/middle clicks — on some Electron/Windows builds contextmenu
    // also fires a click event, which would immediately close the menu we just opened
    if (e.button !== 0) return;
    // Don't close context menu when clicking inside it (let its own onclick handle it)
    if (document.getElementById('ctx-menu')?.contains(e.target)) return;
    hideContextMenu();
    const m = document.getElementById('tools-menu');
    if (m && !m.contains(e.target)) m.style.display = 'none';
  });
  render();

  setTimeout(() => {
    window.api.checkUpdate().then(r => {
      if (r?.hasUpdate) showUpdateModal(r.currentVersion, r.latestVersion, r.url);
    }).catch(() => {});
  }, 5000);
});

function render() {
  document.getElementById('titlebar-host').innerHTML = `
    <div class="titlebar">
      <div class="titlebar-logo"><div class="dot">⚡</div><span>AOSSH</span></div>
      <div class="tabs" id="tabs-container"></div>
      <div class="drag-zone"></div>
      <div class="titlebar-tools">
        <button class="tools-btn" id="ai-toggle-btn" onclick="toggleAiPanel()" title="AI Assistant">🤖</button>
        <button class="tools-btn" id="tools-menu-btn" onclick="toggleToolsMenu(event)" title="Tools">⚙️</button>
        <div class="tools-menu" id="tools-menu" style="display:none">
          <div class="ctx-section">Connections</div>
          <div class="ctx-item" onclick="exportConnections()">Export...</div>
          <div class="ctx-divider"></div>
          <div class="ctx-section">Import</div>
          <div class="ctx-item" onclick="importConnections('merge')">AOSSH — merge</div>
          <div class="ctx-item" onclick="importConnections('replace')">AOSSH — replace all</div>
        </div>
      </div>
      <div class="win-controls">
        <button class="win-btn win-minimize" onclick="window.api.minimize()" title="Minimize"></button>
        <button class="win-btn win-maximize" onclick="window.api.maximize()" title="Maximize"></button>
        <button class="win-btn win-close" onclick="window.api.close()" title="Close"></button>
      </div>
    </div>`;

  document.getElementById('root').innerHTML = `
    <div class="sidebar">
      <div class="sidebar-top">
        <input class="search" placeholder="🔍 Search..." oninput="renderSidebar(this.value)" />
        <button class="btn primary" onclick="openModal()">＋ New Connection</button>
      </div>
      <div class="conn-list" id="conn-list"></div>
      <div class="sidebar-footer" id="sidebar-footer"></div>
    </div>
    <div class="content">
      <div class="toolbar" id="toolbar"></div>
      <div class="pane" id="pane"></div>
    </div>`;

  renderSidebar('');
  renderTabs();
  renderPane();
  syncAiPanelButton();
}

// ── AI Panel ──────────────────────────────────────────────────────────────────
function syncAiPanelButton() {
  const btn = document.getElementById('ai-toggle-btn');
  if (btn) btn.classList.toggle('active', aiPanelOpen);
}

function toggleAiPanel() {
  aiPanelOpen = !aiPanelOpen;
  const panel  = document.getElementById('ai-panel');
  const handle = document.getElementById('ai-resize-handle');
  if (aiPanelOpen) {
    panel.classList.add('visible');
    panel.style.width = aiPanelWidth + 'px';
    handle.classList.add('visible');
    if (aiTabs.length === 0) addAiTab('https://claude.ai');
    else renderAiHeader();
    initAiPanelResize();
  } else {
    panel.classList.remove('visible');
    handle.classList.remove('visible');
  }
  syncAiPanelButton();
}

function renderAiHeader() {
  const header = document.getElementById('ai-panel-header');
  if (!header) return;
  const active = aiTabs.find(t => t.id === activeAiTabId);
  header.innerHTML = `
    <div class="ai-tabs-bar">
      ${aiTabs.map(t => `
        <div class="ai-tab ${t.id === activeAiTabId ? 'active' : ''}" onclick="switchAiTab(${t.id})">
          <span class="ai-tab-title">${escHtml(t.title || 'New Tab')}</span>
          <span class="ai-tab-close" onclick="event.stopPropagation();closeAiTab(${t.id})">✕</span>
        </div>`).join('')}
      <button class="ai-new-tab-btn" onclick="addAiTab('https://www.google.com')" title="New tab">＋</button>
    </div>
    <div class="ai-nav-bar">
      ${AI_PRESETS.map(p => `<button class="ai-preset-btn" onclick="navigateAi('${p.url}')">${escHtml(p.name)}</button>`).join('')}
      <input id="ai-url-input" class="ai-url-input" type="text"
        value="${escHtml(active?.url || '')}"
        placeholder="https://www.google.com"
        onkeydown="if(event.key==='Enter'){navigateAi(this.value);this.blur()}" />
    </div>`;
}

function addAiTab(url) {
  const id = nextAiTabId++;
  aiTabs.push({ id, url, title: 'Loading...' });
  activeAiTabId = id;

  const wv = document.createElement('webview');
  wv.id = `ai-wv-${id}`;
  wv.src = url;
  wv.setAttribute('partition', 'persist:ai');
  wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  wv.setAttribute('allowpopups', '');
  wv.style.cssText = '';

  document.querySelectorAll('#ai-webviews webview').forEach(w => w.classList.remove('active'));
  document.getElementById('ai-webviews').appendChild(wv);
  wv.classList.add('active');

  wv.addEventListener('did-fail-load', e => {
    if (e.errorCode === -3) return; // ERR_ABORTED = redirect, ignore
  });
  wv.addEventListener('page-title-updated', e => {
    const tab = aiTabs.find(t => t.id === id);
    if (tab) { tab.title = e.title; renderAiHeader(); }
  });
  wv.addEventListener('did-navigate', e => {
    const tab = aiTabs.find(t => t.id === id);
    if (tab) tab.url = e.url;
    if (activeAiTabId === id) {
      const inp = document.getElementById('ai-url-input');
      if (inp) inp.value = e.url;
    }
  });
  renderAiHeader();
}

function switchAiTab(id) {
  activeAiTabId = id;
  document.querySelectorAll('#ai-webviews webview').forEach(wv => {
    wv.classList.toggle('active', wv.id === `ai-wv-${id}`);
  });
  renderAiHeader();
}

function closeAiTab(id) {
  const idx = aiTabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  aiTabs.splice(idx, 1);
  document.getElementById(`ai-wv-${id}`)?.remove();
  if (aiTabs.length === 0) { toggleAiPanel(); return; }
  if (activeAiTabId === id) switchAiTab(aiTabs[Math.min(idx, aiTabs.length - 1)].id);
  else renderAiHeader();
}

function navigateAi(url) {
  if (!url.match(/^https?:\/\//)) url = 'https://' + url;
  const wv = document.getElementById(`ai-wv-${activeAiTabId}`);
  if (wv) wv.src = url;
  const tab = aiTabs.find(t => t.id === activeAiTabId);
  if (tab) tab.url = url;
  const inp = document.getElementById('ai-url-input');
  if (inp) inp.value = url;
}

function initAiPanelResize() {
  const handle = document.getElementById('ai-resize-handle');
  if (!handle || handle._init) return;
  handle._init = true;
  let startX, startWidth;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = document.getElementById('ai-panel').offsetWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    // Cover webviews so they don't swallow mouse events during drag
    const overlay = document.createElement('div');
    overlay.id = 'drag-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;';
    document.body.appendChild(overlay);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  function onMove(e) {
    const w = Math.max(280, Math.min(900, startWidth - (e.clientX - startX)));
    aiPanelWidth = w;
    document.getElementById('ai-panel').style.width = w + 'px';
  }
  function onUp() {
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.getElementById('drag-overlay')?.remove();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
}

// ── Update Modal ──────────────────────────────────────────────────────────────
function showUpdateModal(current, latest, url) {
  window._updateUrl = url;
  const mc = document.getElementById('modal-container');
  mc.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="width:360px" onclick="event.stopPropagation()">
        <h2>Update Available <span class="icon-btn" onclick="closeModal()" style="font-size:18px">✕</span></h2>
        <p style="color:#8b949e;font-size:13px;margin:0 0 8px">A new version of AOSSH is available.</p>
        <p style="font-size:13px;margin:0 0 20px">
          Current: <span style="color:#8b949e">v${escHtml(current)}</span>
          &nbsp;→&nbsp;
          Latest: <span style="color:#3fb950;font-weight:600">v${escHtml(latest)}</span>
        </p>
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">Later</button>
          <button class="btn primary" onclick="openUpdatePage()">⬇ Download</button>
        </div>
      </div>
    </div>`;
}

function openUpdatePage() {
  if (window._updateUrl) window.api.openExternal(window._updateUrl);
  closeModal();
}

// ── Tools Menu ────────────────────────────────────────────────────────────────
function toggleToolsMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('tools-menu');
  if (!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

async function exportConnections() {
  document.getElementById('tools-menu').style.display = 'none';
  const result = await window.api.exportConnections();
  if (result?.ok) showToast('✅ Exported successfully');
  else if (result?.error) showToast('❌ ' + result.error);
}

async function importConnections(mode) {
  document.getElementById('tools-menu').style.display = 'none';
  const result = await window.api.importConnections();
  if (result?.cancelled) return;
  if (result?.error) { showToast('❌ ' + result.error); return; }
  if (mode === 'replace') {
    connections = result.data.map(c => ({ ...c, status: 'offline' }));
  } else {
    // merge — skip duplicates by id
    const existingIds = new Set(connections.map(c => c.id));
    const newConns = result.data
      .filter(c => !existingIds.has(c.id))
      .map(c => ({ ...c, status: 'offline' }));
    connections = [...connections, ...newConns];
    showToast(`✅ Imported ${newConns.length} connection(s)`);
  }
  await window.api.saveConnections(connections);
  renderSidebar('');
  if (mode === 'replace') showToast(`✅ Replaced with ${connections.length} connection(s)`);
}


function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function toggleGroup(key) {
  collapsedGroups[key] = !collapsedGroups[key];
  localStorage.setItem('collapsedGroups', JSON.stringify(collapsedGroups));
  renderSidebar(document.querySelector('.search')?.value || '');
}

function renderSidebar(q = '') {
  const list = document.getElementById('conn-list');
  if (!list) return;

  // Build tree: { group: { __conns: [], subgroup: [conn,...] } }
  const tree = {};
  connections.forEach(c => {
    const g = c.group || 'Default';
    const s = c.subgroup || '';
    if (!tree[g]) tree[g] = { __conns: [] };
    if (s) { if (!tree[g][s]) tree[g][s] = []; if (!c.__placeholder__) tree[g][s].push(c); }
    else { if (!c.__placeholder__) tree[g].__conns.push(c); }
  });

  const ql = q.toLowerCase();
  const match = c => !q || c.name.toLowerCase().includes(ql) || c.host.toLowerCase().includes(ql);

  let html = '';
  Object.keys(tree).forEach(g => {
    const allConns = [
      ...tree[g].__conns,
      ...Object.keys(tree[g]).filter(k => k !== '__conns').flatMap(s => tree[g][s])
    ].filter(match);
    if (!allConns.length) return;

    const gCol = collapsedGroups[g];
    html += `<div class="group-header" onclick="toggleGroup('${escHtml(g)}')" oncontextmenu="showCtxMenu(event,'${escHtml(g)}',null)">
      <span class="group-arrow">${gCol ? '▶' : '▼'}</span>
      <span class="group-name">${escHtml(g)}</span>
      <span class="group-count">${allConns.length}</span>
    </div>`;

    if (!gCol) {
      tree[g].__conns.filter(match).forEach(c => { html += connItem(c, false); });
      // Subgroups (including empty ones from placeholders)
      const allSubs = [...new Set(
        connections.filter(c => (c.group||'Default') === g && c.subgroup).map(c => c.subgroup)
      )];
      allSubs.forEach(s => {
        const sc = (tree[g][s] || []).filter(match);
        const sk = `${g}/${s}`;
        const sCol = collapsedGroups[sk];
        html += `<div class="subgroup-header" onclick="toggleGroup('${escHtml(sk)}')" oncontextmenu="showCtxMenu(event,'${escHtml(g)}','${escHtml(s)}')">
          <span class="subgroup-arrow">${sCol ? '▶' : '▼'}</span>
          <span class="subgroup-name">${escHtml(s)}</span>
          <span class="group-count">${sc.length}</span>
        </div>`;
        if (!sCol) sc.forEach(c => { html += connItem(c, true); });
      });
    }
  });

  list.innerHTML = html;
  const footer = document.getElementById('sidebar-footer');
  if (footer) {
    const online = connections.filter(c => c.status === 'online').length;
    footer.textContent = `${online} online · ${connections.length} total`;
  }
}

function connItem(c, indented) {
  return `<div class="conn-item ${selectedConnId===c.id?'active':''} ${indented?'indented':''}"
    onclick="highlightConn(${c.id})"
    ondblclick="selectConn(${c.id})"
    oncontextmenu="showConnCtxMenu(event,${c.id})">
    <div class="conn-name">
      <div class="status-dot ${c.status||'offline'}"></div>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.name)}</span>
    </div>
    <div class="conn-host${indented?' indented':''}">${escHtml(c.username)}@${escHtml(c.host)}:${c.port||22}</div>
  </div>`;
}

// ── Context Menu ──────────────────────────────────────────────────────────────
function showCtxMenu(e, group, subgroup) {
  e.preventDefault(); e.stopPropagation();
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = subgroup !== null ? `
    <div class="ctx-item" onclick="renameGroup('${escHtml(group)}','${escHtml(subgroup)}')">✏️ Rename</div>
    <div class="ctx-item ctx-danger" onclick="deleteGroup('${escHtml(group)}','${escHtml(subgroup)}')">🗑️ Delete</div>
  ` : `
    <div class="ctx-item" onclick="addSubgroup('${escHtml(group)}')">＋ Add subgroup</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" onclick="renameGroup('${escHtml(group)}',null)">✏️ Rename</div>
    <div class="ctx-item ctx-danger" onclick="deleteGroup('${escHtml(group)}',null)">🗑️ Delete</div>
  `;
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
}

function hideContextMenu() {
  const m = document.getElementById('ctx-menu');
  if (m) m.style.display = 'none';
  document.querySelectorAll('.ctx-submenu').forEach(el => el.remove());
}

function showConnCtxMenu(e, connId) {
  e.preventDefault(); e.stopPropagation();
  const conn = connections.find(c => c.id === connId);
  if (!conn) return;
  const menu = document.getElementById('ctx-menu');

  // Build groups/subgroups list for Move submenu
  const allGroups = [...new Set(connections.map(c => c.group||'Default'))];

  menu.innerHTML = `
    <div class="ctx-item ctx-connect" onclick="selectConn(${connId});hideContextMenu()">⚡ Connect</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" onclick="openModal(${connId});hideContextMenu()">✏️ Edit</div>
    <div class="ctx-item ctx-has-sub" onmouseenter="showMoveSubmenu(event,${connId})">
      📂 Move to...
      <span class="ctx-arrow">▶</span>
    </div>
    <div class="ctx-divider"></div>
    <div class="ctx-item ctx-danger" onclick="deleteConn(${connId});hideContextMenu()">🗑️ Delete</div>
  `;

  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px';
}

function showMoveSubmenu(e, connId) {
  document.querySelectorAll('.ctx-submenu').forEach(el => el.remove());

  const conn = connections.find(c => c.id === connId);
  if (!conn) return;

  const allGroups = [...new Set(connections.map(c => c.group||'Default'))];
  let html = '';
  allGroups.forEach(g => {
    const subs = [...new Set(
      connections.filter(c => (c.group||'Default') === g && c.subgroup).map(c => c.subgroup)
    )];
    const hasSubs = subs.length > 0;
    html += `<div class="ctx-item ctx-submenu-group ${hasSubs?'ctx-has-sub':''}"
      onclick="${hasSubs?'':` moveConn(${connId},'${escHtml(g)}',null);hideContextMenu()`}"
      onmouseenter="showSubgroupLevel(event,${connId},'${escHtml(g)}')">
      📁 ${escHtml(g)}${hasSubs?'<span class="ctx-arrow">▶</span>':''}
    </div>`;
  });

  const item = e.currentTarget;
  const rect = item.getBoundingClientRect();
  const menu = document.getElementById('ctx-menu');
  const menuRect = menu.getBoundingClientRect();

  const sub = document.createElement('div');
  sub.className = 'ctx-menu ctx-submenu ctx-submenu-l1';
  sub.id = 'ctx-submenu-l1';
  sub.innerHTML = html;
  sub.style.position = 'fixed';
  sub.style.top = rect.top + 'px';
  sub.style.left = (window.innerWidth - menuRect.right > 160 ? menuRect.right + 2 : menuRect.left - 162) + 'px';
  document.body.appendChild(sub);
}

function showSubgroupLevel(e, connId, group) {
  // Remove level 2 submenu if exists
  document.querySelectorAll('.ctx-submenu-l2').forEach(el => el.remove());

  const subs = [...new Set(
    connections.filter(c => (c.group||'Default') === group && c.subgroup).map(c => c.subgroup)
  )];
  if (!subs.length) return;

  let html = `<div class="ctx-item ctx-submenu-group" onclick="moveConn(${connId},'${escHtml(group)}',null);hideContextMenu()">
    📁 ${escHtml(group)} <span style="color:#484f58;font-size:11px">(root)</span>
  </div>
  <div class="ctx-divider"></div>`;

  subs.forEach(s => {
    html += `<div class="ctx-item ctx-submenu-sub" onclick="moveConn(${connId},'${escHtml(group)}','${escHtml(s)}');hideContextMenu()">
      ↳ ${escHtml(s)}
    </div>`;
  });

  const item = e.currentTarget;
  const rect = item.getBoundingClientRect();
  const l1 = document.getElementById('ctx-submenu-l1');
  const l1Rect = l1 ? l1.getBoundingClientRect() : rect;

  const sub2 = document.createElement('div');
  sub2.className = 'ctx-menu ctx-submenu ctx-submenu-l2';
  sub2.innerHTML = html;
  sub2.style.position = 'fixed';
  sub2.style.top = rect.top + 'px';
  sub2.style.left = (window.innerWidth - l1Rect.right > 160 ? l1Rect.right + 2 : l1Rect.left - 162) + 'px';
  document.body.appendChild(sub2);
}

async function moveConn(connId, group, subgroup) {
  hideContextMenu();
  document.querySelectorAll('.ctx-submenu').forEach(el => el.remove());
  connections = connections.map(c =>
    c.id === connId ? { ...c, group, subgroup: subgroup || null } : c
  );
  await window.api.saveConnections(connections);
  renderSidebar(document.querySelector('.search')?.value || '');
}

function addSubgroup(group) {
  hideContextMenu();
  showInputModal(`Add subgroup to "${group}"`, 'Subgroup name', '', async name => {
    if (!name.trim()) return;
    // Check if subgroup already exists
    const exists = connections.some(c => (c.group||'Default') === group && (c.subgroup||'') === name.trim());
    if (exists) return;
    // Add a placeholder connection that marks the subgroup exists
    // It won't show as a real connection — we filter __placeholder__ in render
    connections.push({
      id: Date.now(),
      __placeholder__: true,
      name: `__subgroup__`,
      group,
      subgroup: name.trim(),
      host: '', port: 22, username: '', status: 'offline',
    });
    await window.api.saveConnections(connections);
    renderSidebar(document.querySelector('.search')?.value || '');
  });
}

function renameGroup(group, subgroup) {
  hideContextMenu();
  const current = subgroup || group;
  showInputModal('Rename', 'New name', current, newName => {
    if (!newName.trim() || newName.trim() === current) return;
    connections = connections.map(c => {
      if (subgroup !== null) {
        if ((c.group||'Default') === group && (c.subgroup||'') === subgroup)
          return { ...c, subgroup: newName.trim() };
      } else {
        if ((c.group||'Default') === group) return { ...c, group: newName.trim() };
      }
      return c;
    });
    window.api.saveConnections(connections);
    renderSidebar(document.querySelector('.search')?.value || '');
  });
}

function showConfirmModal(title, message, onConfirm) {
  const mc = document.getElementById('modal-container');
  mc.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="width:320px" onclick="event.stopPropagation()">
        <h2>${escHtml(title)} <span class="icon-btn" onclick="closeModal()" style="font-size:18px">✕</span></h2>
        <p style="color:#8b949e;font-size:13px;margin-bottom:20px">${escHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">Cancel</button>
          <button class="btn danger" onclick="confirmModal()">Delete</button>
        </div>
      </div>
    </div>`;
  window._confirmModalCallback = onConfirm;
}

function confirmModal() {
  const cb = window._confirmModalCallback;
  closeModal();
  if (cb) cb();
}

function showInputModal(title, label, defaultVal, onConfirm) {
  const mc = document.getElementById('modal-container');
  mc.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="width:320px" onclick="event.stopPropagation()">
        <h2>${escHtml(title)} <span class="icon-btn" onclick="closeModal()" style="font-size:18px">✕</span></h2>
        <div class="form-group">
          <label>${escHtml(label)}</label>
          <input id="input-modal-val" value="${escHtml(defaultVal)}" placeholder="${escHtml(label)}" onkeydown="if(event.key==='Enter')confirmInputModal()" />
        </div>
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">Cancel</button>
          <button class="btn primary" onclick="confirmInputModal()">Confirm</button>
        </div>
      </div>
    </div>`;
  setTimeout(() => {
    const inp = document.getElementById('input-modal-val');
    if (inp) { inp.focus(); inp.select(); }
  }, 50);
  window._inputModalCallback = onConfirm;
}

function confirmInputModal() {
  const val = document.getElementById('input-modal-val')?.value || '';
  const cb = window._inputModalCallback;
  closeModal();
  if (cb) cb(val);
}

function deleteGroup(group, subgroup) {
  hideContextMenu();
  const label = subgroup ? `subgroup "${subgroup}"` : `group "${group}"`;
  const count = connections.filter(c =>
    (c.group||'Default') === group && (subgroup ? (c.subgroup||'') === subgroup : true)
  ).length;
  showConfirmModal('Delete', `Delete ${label} and all ${count} connection(s)?`, async () => {
    connections = connections.filter(c =>
      subgroup
        ? !((c.group||'Default') === group && (c.subgroup||'') === subgroup)
        : (c.group||'Default') !== group
    );
    window.api.saveConnections(connections);
    renderSidebar(document.querySelector('.search')?.value || '');
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function renderTabs() {
  const el = document.getElementById('tabs-container');
  if (!el) return;
  el.innerHTML = tabs.map(t => `
    <div class="tab ${t.id===activeTabId?'active':''}" onclick="setActiveTab(${t.id})">
      <span>${t.type==='sftp'?'📁':'⚡'}</span>
      <span style="overflow:hidden;text-overflow:ellipsis">${escHtml(t.label)}</span>
      <span class="tab-close" onclick="closeTab(event,${t.id})">✕</span>
    </div>`).join('');
}

function renderToolbar() {
  const el = document.getElementById('toolbar');
  if (!el) return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="toolbar-btn ${tab.type==='terminal'?'active':''}" onclick="switchTabType('terminal')">⚡ SSH Terminal</button>
    <button class="toolbar-btn ${tab.type==='sftp'?'active':''}" onclick="switchTabType('sftp')">📁 SFTP</button>
    <div style="flex:1"></div>
    ${tab.type==='sftp'?`
      <button class="toolbar-btn" onclick="sftpUpload()">📤 Upload</button>
      <button class="toolbar-btn" onclick="sftpMkdir()">📁 New Folder</button>
      <button class="toolbar-btn" onclick="sftpRefresh()">🔄 Refresh</button>`:''}
    <button class="toolbar-btn" onclick="disconnectTab()" style="color:#f85149">🔌 Disconnect</button>`;
}

function renderPane() {
  renderToolbar();
  const pane = document.getElementById('pane');
  if (!pane) return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) {
    pane.innerHTML = `
      <div class="welcome">
        <div class="welcome-logo">
          <div class="welcome-dot">⚡</div>
          <div class="welcome-title">AOSSH</div>
          <div class="welcome-sub">SSH & SFTP Client</div>
          <div class="welcome-version" id="welcome-version">v...</div>
        </div>
        <div class="welcome-manual">
          <div class="manual-section">
            <div class="manual-title">🖱 Connections</div>
            <div class="manual-item"><span class="manual-key">Single click</span> — select connection</div>
            <div class="manual-item"><span class="manual-key">Double click</span> — connect</div>
            <div class="manual-item"><span class="manual-key">Right click</span> — Connect / Edit / Move / Delete</div>
          </div>
          <div class="manual-section">
            <div class="manual-title">📁 Groups</div>
            <div class="manual-item"><span class="manual-key">Click on group</span> — collapse / expand</div>
            <div class="manual-item"><span class="manual-key">Right click on group</span> — add subgroup / rename / delete</div>
          </div>
          <div class="manual-section">
            <div class="manual-title">⚡ Sessions</div>
            <div class="manual-item"><span class="manual-key">SSH Terminal</span> — interactive shell</div>
            <div class="manual-item"><span class="manual-key">SFTP</span> — file manager, upload & download</div>
            <div class="manual-item"><span class="manual-key">Multiple tabs</span> — connect to several servers at once</div>
          </div>
          <div class="manual-section">
            <div class="manual-title">📂 SFTP</div>
            <div class="manual-item"><span class="manual-key">Drag & drop</span> — upload files into the file list</div>
            <div class="manual-item"><span class="manual-key">Right click file/folder</span> — download, edit, rename, delete</div>
            <div class="manual-item"><span class="manual-key">✕ in status bar</span> — cancel active upload</div>
          </div>
          <div class="manual-section">
            <div class="manual-title">🤖 AI Panel</div>
            <div class="manual-item"><span class="manual-key">🤖 button</span> — open / close AI browser panel</div>
            <div class="manual-item"><span class="manual-key">Tabs</span> — ChatGPT, Claude, Gemini, Grok, Perplexity</div>
            <div class="manual-item"><span class="manual-key">Sessions saved</span> — stay logged in between restarts</div>
          </div>
        </div>
      </div>`;
    window.api.getVersion().then(v => {
      const el = document.getElementById('welcome-version');
      if (el) el.textContent = 'v' + v;
    });
    return;
  }
  if (tab.type === 'terminal') {
    pane.innerHTML = `<div id="terminal-container"></div><div class="terminal-footer"></div>`;
    initTerminal(tab);
  } else {
    pane.innerHTML = `
      <div class="sftp-path">
        <span>📁</span>
        <input id="sftp-path-input" value="${escHtml(tab.sftpPath||'/')}" onkeydown="if(event.key==='Enter')navigateSftp(this.value)" />
        <button class="icon-btn" onclick="sftpRefresh()">↻</button>
      </div>
      <div class="file-header"><span>Name</span><span>Size</span><span>Modified</span><span>Actions</span></div>
      <div class="file-list" id="file-list"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="if(!this.contains(event.relatedTarget))this.classList.remove('drag-over')"
        ondrop="sftpHandleDrop(event)">
        <div style="padding:20px;color:#484f58;text-align:center">Loading...</div>
      </div>
      <div class="sftp-status">
        <div id="sftp-status-default"><span id="sftp-count">—</span><span>Drop files here to upload</span></div>
        <div id="sftp-progress-bar" class="sftp-progress-bar" style="display:none"></div>
      </div>`;
    loadSftp(tab);
  }
}

// ── Terminal ──────────────────────────────────────────────────────────────────
function initTerminal(tab) {
  if (terminals[tab.id]) {
    const c = document.getElementById('terminal-container');
    if (c) { terminals[tab.id].term.open(c); setTimeout(() => terminals[tab.id].fitAddon.fit(), 50); }
    return;
  }
  const conn = connections.find(c => c.id === tab.connId);
  const termTheme = { background:'#0d1117', foreground:'#c9d1d9', cursor:'#58a6ff', selectionBackground:'rgba(88,166,255,0.3)' };
  const term = new Terminal({ cursorBlink:true, fontSize:13, fontFamily:"'Cascadia Code','JetBrains Mono','Fira Code',monospace", theme:termTheme, scrollback:5000, scrollOnUserInput:true });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  const container = document.getElementById('terminal-container');
  if (!container) return;
  term.open(container);
  // Give fitAddon correct dimensions accounting for footer
  setTimeout(() => {
    fitAddon.fit();
    // Force one row less to avoid clipping
    term.resize(term.cols, term.rows - 1);
  }, 50);
  terminals[tab.id] = { term, fitAddon };
  if (!conn) { term.writeln('\x1b[1;31mConnection config not found.\x1b[0m'); return; }
  term.writeln(`\x1b[1;34mConnecting to ${conn.host}:${conn.port||22}...\x1b[0m`);
  conn.status = 'connecting'; renderSidebar('');
  window.api.connect({ id:String(tab.id), host:conn.host, port:conn.port||22, username:conn.username, password:conn.password, privateKey:conn.privateKey||null })
    .then(() => {
      conn.status = 'online'; renderSidebar('');
      window.api.onData(String(tab.id), d => term.write(d));
      window.api.onClosed(String(tab.id), () => { term.writeln('\x1b[1;31m\r\nConnection closed.\x1b[0m'); conn.status='offline'; renderSidebar(''); });
      term.onData(d => window.api.write({ id:String(tab.id), data:d }));

      // Paste text respecting bracketed paste mode (fixes YAML/indentation corruption)
      const pasteToTerminal = text => {
        if (!text) return;
        const bracketed = terminals[tab.id]?.term?.modes?.bracketedPasteMode;
        const data = bracketed ? '\x1b[200~' + text + '\x1b[201~' : text;
        window.api.write({ id: String(tab.id), data });
      };

      // Ctrl+V paste, Ctrl+C copy, Shift+Insert paste (for Windows Server VMs)
      term.attachCustomKeyEventHandler(e => {
        if (e.type !== 'keydown') return true;
        if ((e.ctrlKey && e.code === 'KeyV') || (e.code === 'Insert' && e.shiftKey)) {
          window.api.clipboardRead().then(pasteToTerminal);
          return false;
        }
        if (e.ctrlKey && e.code === 'KeyC' && term.hasSelection()) {
          window.api.clipboardWrite(term.getSelection());
          return false;
        }
        return true;
      });

      // Auto-copy on mouse selection
      term.onSelectionChange(() => {
        const sel = term.getSelection();
        if (sel) window.api.clipboardWrite(sel);
      });

      // Register window-level paste/contextmenu handlers once (shared across all tabs).
      // Window-level capture fires before xterm's own document/window listeners,
      // preventing double-paste on Ctrl+V and enabling right-click paste.
      if (!terminalPasteHandlersRegistered) {
        terminalPasteHandlersRegistered = true;

        // Block paste events so xterm never processes them (our Ctrl+V handler does it)
        window.addEventListener('paste', e => {
          const tc = document.getElementById('terminal-container');
          if (tc && tc.contains(e.target)) {
            e.stopImmediatePropagation();
            e.preventDefault();
          }
        }, true);

        // Right-click → paste clipboard into active terminal
        window.addEventListener('contextmenu', e => {
          const tc = document.getElementById('terminal-container');
          if (!tc || !tc.contains(e.target)) return;
          e.stopImmediatePropagation();
          e.preventDefault();
          const tid = activeTabId;
          const bracketed = terminals[tid]?.term?.modes?.bracketedPasteMode;
          window.api.clipboardRead().then(text => {
            if (!text) return;
            window.api.write({ id: String(tid), data: bracketed ? '\x1b[200~' + text + '\x1b[201~' : text });
          });
        }, true);
      }

      new ResizeObserver(() => {
        fitAddon.fit();
        term.resize(term.cols, Math.max(1, term.rows - 1));
        window.api.resize({ id:String(tab.id), cols:term.cols, rows:term.rows });
      }).observe(container);
    })
    .catch(err => { term.writeln(`\x1b[1;31mConnection failed: ${err}\x1b[0m`); conn.status='offline'; renderSidebar(''); });
}

// ── SFTP ──────────────────────────────────────────────────────────────────────
function updateSftpProgress(data) {
  const bar = document.getElementById('sftp-progress-bar');
  const status = document.getElementById('sftp-status-default');
  if (!bar || !status) return;
  if (!data) {
    bar.style.display = 'none';
    status.style.display = '';
    return;
  }
  status.style.display = 'none';
  bar.style.display = 'flex';
  const pct = data.total ? Math.round((data.transferred / data.total) * 100) : null;
  const tab = tabs.find(t => t.id === activeTabId);
  bar.innerHTML = `<span class="sftp-progress-name">${escHtml(data.name)}</span><div class="sftp-progress-track"><div class="sftp-progress-fill" style="width:${pct ?? 50}%"></div></div><span class="sftp-progress-pct">${pct !== null ? pct + '%' : '...'}</span><button class="sftp-cancel-btn" title="Cancel" onclick="cancelUpload()">✕</button>`;
}

async function cancelUpload() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  await window.api.sftpCancelUpload({ id: String(tab.id) });
  updateSftpProgress(null);
}

async function loadSftp(tab) {
  if (!sftpProgressListeners.has(tab.id)) {
    sftpProgressListeners.add(tab.id);
    window.api.onSftpProgress(String(tab.id), data => updateSftpProgress(data));
  }
  if (!terminals[tab.id]) {
    const conn = connections.find(c => c.id === tab.connId);
    if (!conn) return;
    try {
      await window.api.connect({ id:String(tab.id), host:conn.host, port:conn.port||22, username:conn.username, password:conn.password, privateKey:conn.privateKey||null });
      conn.status = 'online'; renderSidebar('');
    } catch(e) {
      const l = document.getElementById('file-list');
      if (l) l.innerHTML = `<div style="padding:20px;color:#f85149">Connection failed: ${escHtml(String(e))}</div>`;
      return;
    }
  }
  try {
    const files = await window.api.sftpList({ id:String(tab.id), remotePath:tab.sftpPath||'/' });
    const list = document.getElementById('file-list');
    const count = document.getElementById('sftp-count');
    if (!list) return;
    if (count) count.textContent = `${files.length} items`;
    list.innerHTML = [{ name:'..', type:'dir', size:null, modified:'' }, ...files].map(f => {
      const fp = f.name==='..' ? parentPath(tab.sftpPath||'/') : joinPath(tab.sftpPath||'/', f.name);
      return `<div class="file-row"
        data-path="${escHtml(fp)}" data-name="${escHtml(f.name)}" data-type="${f.type}"
        ondblclick="handleFileClick('${escHtml(f.name)}','${f.type}','${escHtml(tab.sftpPath||'/')}')"
        oncontextmenu="event.stopPropagation();sftpFileCtxMenu(event,this)">
        <div class="file-name">${f.type==='dir'?'📁':'📄'}<span>${escHtml(f.name)}</span></div>
        <div class="file-size">${f.size!=null?formatSize(f.size):'—'}</div>
        <div class="file-date">${escHtml(f.modified||'—')}</div>
        <div class="file-actions">
          ${f.type==='file'?`<button class="icon-btn" title="Download" onclick="event.stopPropagation();downloadFile('${escHtml(fp)}')">⬇</button>`:''}
          ${f.name!=='..'?`<button class="icon-btn del" title="Delete" onclick="event.stopPropagation();deleteFile('${escHtml(fp)}','${f.type}')">🗑️</button>`:''}
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    const list = document.getElementById('file-list');
    if (list) list.innerHTML = `<div style="padding:20px;color:#f85149">Error: ${escHtml(String(e))}</div>`;
  }
}

function handleFileClick(name, type, currentPath) {
  if (type !== 'dir') return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  tab.sftpPath = name === '..' ? parentPath(currentPath) : joinPath(currentPath, name);
  const inp = document.getElementById('sftp-path-input');
  if (inp) inp.value = tab.sftpPath;
  loadSftp(tab);
}

function navigateSftp(path) { const tab = tabs.find(t => t.id===activeTabId); if (tab) { tab.sftpPath=path; loadSftp(tab); } }
async function downloadFile(p) { const tab = tabs.find(t => t.id===activeTabId); if (tab) await window.api.sftpGet({ id:String(tab.id), remotePath:p }); }
async function downloadDir(p) {
  const tab = tabs.find(t => t.id===activeTabId); if (!tab) return;
  showToast('⬇ Downloading folder...');
  try {
    const r = await window.api.sftpDownloadDir({ id:String(tab.id), remotePath:p });
    if (!r?.cancelled) showToast('✅ Folder downloaded');
  } catch(e) { showToast('❌ ' + e); }
}
async function deleteFile(p, type) {
  showConfirmModal('Delete', `Delete "${p}"?`, async () => {
    const tab = tabs.find(t => t.id===activeTabId);
    if (!tab) return;
    if (type === 'dir') await window.api.sftpDeleteDir({ id:String(tab.id), remotePath:p });
    else await window.api.sftpDelete({ id:String(tab.id), remotePath:p });
    loadSftp(tab);
  });
}
async function sftpUpload() {
  const tab = tabs.find(t => t.id===activeTabId); if (!tab) return;
  const r = await window.api.sftpPut({ id:String(tab.id), remotePath:tab.sftpPath||'/' });
  if (r?.cancelled) return;
  if (r?.count > 1) showToast(`✅ Uploaded ${r.count} file(s)`);
  loadSftp(tab);
}
function sftpMkdir() {
  showInputModal('New Folder', 'Folder name', '', async name => {
    if (!name) return;
    const tab = tabs.find(t => t.id===activeTabId); if (!tab) return;
    try {
      await window.api.sftpMkdir({ id:String(tab.id), remotePath:joinPath(tab.sftpPath||'/', name) });
      loadSftp(tab);
    } catch(e) { showToast('❌ ' + e); }
  });
}
function sftpRefresh() { const tab = tabs.find(t => t.id===activeTabId); if (tab) loadSftp(tab); }

async function sftpHandleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const tab = tabs.find(t => t.id===activeTabId); if (!tab) return;
  const files = [...e.dataTransfer.files];
  if (!files.length) return;
  const localPaths = files.map(f => f.path).filter(Boolean);
  if (!localPaths.length) return;
  showToast(`⬆ Uploading ${localPaths.length} file(s)...`);
  try {
    await window.api.sftpUploadFiles({ id:String(tab.id), remotePath:tab.sftpPath||'/', localPaths });
    showToast(`✅ Uploaded ${localPaths.length} file(s)`);
    loadSftp(tab);
  } catch(e) { showToast('❌ Upload failed: ' + e); }
}

function sftpFileCtxMenu(e, row) {
  e.preventDefault();
  hideContextMenu();
  const fp   = row.dataset.path;
  const name = row.dataset.name;
  const type = row.dataset.type;
  window._sftpCtxFile = { fp, name, type };
  const isFile   = type === 'file';
  const isParent = name === '..';
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = `
    ${isFile  ? `<div class="ctx-item" onclick="downloadFile(window._sftpCtxFile.fp);hideContextMenu()">⬇️ Download</div>` : ''}
    ${!isFile && !isParent ? `<div class="ctx-item" onclick="downloadDir(window._sftpCtxFile.fp);hideContextMenu()">⬇️ Download folder</div>` : ''}
    ${isFile ? `<div class="ctx-item" onclick="sftpEditFile(window._sftpCtxFile.fp);hideContextMenu()">✏️ Edit</div>` : ''}
    ${!isParent ? `<div class="ctx-item" onclick="sftpRenameFile(window._sftpCtxFile.fp,window._sftpCtxFile.name);hideContextMenu()">📝 Rename</div>` : ''}
    ${!isParent ? `<div class="ctx-divider"></div><div class="ctx-item ctx-danger" onclick="deleteFile(window._sftpCtxFile.fp,window._sftpCtxFile.type);hideContextMenu()">🗑️ Delete</div>` : ''}
  `;
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 130) + 'px';
}

function sftpRenameFile(fp, currentName) {
  showInputModal('Rename', 'New name', currentName, async newName => {
    if (!newName || newName === currentName) return;
    const tab = tabs.find(t => t.id===activeTabId); if (!tab) return;
    const newPath = fp.slice(0, fp.lastIndexOf('/') + 1) + newName;
    try {
      await window.api.sftpRename({ id:String(tab.id), oldPath:fp, newPath });
      loadSftp(tab);
    } catch(e) { showToast('❌ Rename failed: ' + e); }
  });
}

async function sftpEditFile(fp) {
  const tab = tabs.find(t => t.id===activeTabId); if (!tab) return;
  showToast('📄 Loading file...');
  try {
    const r = await window.api.sftpReadFile({ id:String(tab.id), remotePath:fp });
    showFileEditModal(fp, r.content);
  } catch(e) { showToast('❌ ' + e); }
}

function showFileEditModal(fp, content) {
  window._editFilePath = fp;
  const mc = document.getElementById('modal-container');
  mc.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="width:720px;max-width:92vw" onclick="event.stopPropagation()">
        <h2>Edit: ${escHtml(fp.split('/').pop())} <span class="icon-btn" onclick="closeModal()" style="font-size:18px">✕</span></h2>
        <textarea id="file-edit-content" class="file-editor">${escHtml(content)}</textarea>
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">Cancel</button>
          <button class="btn primary" onclick="sftpSaveEdit()">Save</button>
        </div>
      </div>
    </div>`;
  setTimeout(() => document.getElementById('file-edit-content')?.focus(), 50);
}

async function sftpSaveEdit() {
  const fp      = window._editFilePath;
  const content = document.getElementById('file-edit-content')?.value;
  if (!fp || content === undefined) return;
  const tab = tabs.find(t => t.id===activeTabId); if (!tab) return;
  closeModal();
  try {
    await window.api.sftpWriteFile({ id:String(tab.id), remotePath:fp, content });
    showToast('✅ File saved');
  } catch(e) { showToast('❌ Save failed: ' + e); }
}

// ── Tab management ────────────────────────────────────────────────────────────
function highlightConn(id) {
  selectedConnId = id;
  renderSidebar(document.querySelector('.search')?.value || '');
}

function selectConn(id) {
  selectedConnId = id; renderSidebar('');
  const conn = connections.find(c => c.id===id); if (!conn) return;
  const ex = tabs.find(t => t.connId===id && t.type==='terminal');
  if (ex) { setActiveTab(ex.id); return; }
  addTab(conn, 'terminal');
}
function addTab(conn, type) { const id=Date.now(); tabs.push({ id, connId:conn.id, type, label:conn.name+(type==='sftp'?' — SFTP':''), sftpPath:'/' }); setActiveTab(id); }
function setActiveTab(id) { activeTabId=id; renderTabs(); renderPane(); }
function closeTab(e, id) {
  e.stopPropagation();
  window.api.disconnect({ id:String(id) }).catch(()=>{});
  if (terminals[id]) { terminals[id].term.dispose(); delete terminals[id]; }
  tabs = tabs.filter(t => t.id!==id);
  if (activeTabId===id) activeTabId = tabs.length ? tabs[tabs.length-1].id : null;
  renderTabs(); renderPane();
}
function newTabForSelected() { const conn = connections.find(c => c.id===selectedConnId); if (conn) addTab(conn,'terminal'); }
function switchTabType(type) {
  const tab = tabs.find(t => t.id===activeTabId); if (!tab||tab.type===type) return;
  tab.type=type; const conn=connections.find(c=>c.id===tab.connId);
  tab.label=(conn?.name||'?')+(type==='sftp'?' — SFTP':''); renderTabs(); renderPane();
}
function disconnectTab() { const tab=tabs.find(t=>t.id===activeTabId); if (tab) closeTab({stopPropagation:()=>{}},tab.id); }

// ── Connection Modal ──────────────────────────────────────────────────────────
function openModal(editId=null, prefillGroup=null, prefillSub=null) {
  const c = (editId ? connections.find(c=>c.id===editId) : null) ?? {};
  const allGroups = [...new Set(connections.map(c=>c.group||'Default'))];
  if (!allGroups.length) allGroups.push('Default');
  const curGroup = c.group || prefillGroup || allGroups[0];
  const allSubs = [...new Set(connections.filter(c=>(c.group||'Default')===curGroup && c.subgroup).map(c=>c.subgroup))];
  const curSub = c.subgroup || prefillSub || '';

  document.getElementById('modal-container').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" onclick="event.stopPropagation()">
        <h2>${editId?'Edit':'New'} Connection <span class="icon-btn" onclick="closeModal()" style="font-size:18px">✕</span></h2>
        <div class="form-group"><label>Name</label><input id="m-name" value="${escHtml(c.name||'')}" placeholder="My Server" /></div>
        <div class="form-row">
          <div class="form-group"><label>Host / IP</label><input id="m-host" value="${escHtml(c.host||'')}" placeholder="192.168.1.1" /></div>
          <div class="form-group" style="max-width:80px"><label>Port</label><input id="m-port" value="${c.port||22}" type="number" min="1" max="65535" /></div>
        </div>
        <div class="form-group"><label>Username</label><input id="m-user" value="${escHtml(c.username||'')}" placeholder="root" /></div>
        <div class="form-group">
          <label>Auth Type</label>
          <select id="m-auth" onchange="toggleAuth(this.value)">
            <option value="password" ${(c.authType||'password')==='password'?'selected':''}>Password</option>
            <option value="key" ${c.authType==='key'?'selected':''}>SSH Key (file path)</option>
          </select>
        </div>
        <div class="form-group" id="m-pass-group" style="${c.authType==='key'?'display:none':''}">
          <label>Password</label><input id="m-pass" type="password" value="${escHtml(c.password||'')}" placeholder="••••••••" />
        </div>
        <div class="form-group" id="m-key-group" style="${c.authType==='key'?'':'display:none'}">
          <label>Private Key Path</label>
          <div class="key-input-row">
            <input id="m-key" value="${escHtml(c.privateKey||'')}" placeholder="C:\\Users\\you\\.ssh\\id_rsa" />
            <button class="btn" type="button" onclick="browseKeyFile()">Browse...</button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Group</label>
            <select id="m-group-select" onchange="onGroupChange(this.value)">
              ${allGroups.map(g=>`<option value="${escHtml(g)}" ${g===curGroup?'selected':''}>${escHtml(g)}</option>`).join('')}
              <option value="__new__">＋ New group...</option>
            </select>
          </div>
          <div class="form-group">
            <label>Subgroup <span style="color:#484f58;font-weight:400">(optional)</span></label>
            <select id="m-sub-select" onchange="onSubChange(this.value)">
              <option value="" ${!curSub?'selected':''}>— None —</option>
              ${allSubs.map(s=>`<option value="${escHtml(s)}" ${s===curSub?'selected':''}>${escHtml(s)}</option>`).join('')}
              <option value="__new__">＋ New subgroup...</option>
            </select>
          </div>
        </div>
        <div class="form-group" id="m-newgroup-wrap" style="display:none">
          <label>New group name</label><input id="m-group-new" placeholder="Production" />
        </div>
        <div class="form-group" id="m-newsub-wrap" style="${prefillSub&&!allSubs.includes(prefillSub)?'':'display:none'}">
          <label>New subgroup name</label><input id="m-sub-new" value="${escHtml(prefillSub||'')}" placeholder="Web" />
        </div>
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">Cancel</button>
          ${editId?`<button class="btn danger" onclick="deleteConn(${editId})">Delete</button>`:''}
          <button class="btn primary" onclick="saveConn(${editId||'null'})">${editId?'Save Changes':'Add Connection'}</button>
        </div>
      </div>
    </div>`;
}

function onGroupChange(val) {
  document.getElementById('m-newgroup-wrap').style.display = val==='__new__' ? '' : 'none';
  if (val !== '__new__') {
    const subs = [...new Set(connections.filter(c=>(c.group||'Default')===val&&c.subgroup).map(c=>c.subgroup))];
    document.getElementById('m-sub-select').innerHTML =
      `<option value="">— None —</option>` +
      subs.map(s=>`<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('') +
      `<option value="__new__">＋ New subgroup...</option>`;
    document.getElementById('m-newsub-wrap').style.display = 'none';
  }
}

function onSubChange(val) {
  document.getElementById('m-newsub-wrap').style.display = val==='__new__' ? '' : 'none';
}

async function browseKeyFile() {
  const result = await window.api.browseFile({
    title: 'Select Private Key',
    filters: [
      { name: 'Private Key', extensions: ['pem', 'ppk', 'key', 'rsa'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result) document.getElementById('m-key').value = result;
}

function toggleAuth(v) {
  document.getElementById('m-pass-group').style.display = v==='key' ? 'none' : '';
  document.getElementById('m-key-group').style.display  = v==='key' ? '' : 'none';
}

function closeModal() { document.getElementById('modal-container').innerHTML = ''; }

async function saveConn(editId) {
  const name = document.getElementById('m-name').value.trim();
  const host = document.getElementById('m-host').value.trim();
  if (!name||!host) { alert('Name and Host are required'); return; }
  const gSel = document.getElementById('m-group-select').value;
  const group = gSel==='__new__' ? (document.getElementById('m-group-new').value.trim()||'Default') : gSel;
  const sSel = document.getElementById('m-sub-select').value;
  const subgroup = sSel==='__new__' ? (document.getElementById('m-sub-new').value.trim()||'') : sSel;
  const conn = {
    id: editId||Date.now(), name, host,
    port: parseInt(document.getElementById('m-port').value)||22,
    username: document.getElementById('m-user').value.trim(),
    authType: document.getElementById('m-auth').value,
    password: document.getElementById('m-pass').value,
    privateKey: document.getElementById('m-key').value.trim()||null,
    group, subgroup: subgroup||null,
    status: editId ? (connections.find(c=>c.id===editId)?.status||'offline') : 'offline',
  };
  if (editId) connections = connections.map(c=>c.id===editId?conn:c);
  else connections.push(conn);
  await window.api.saveConnections(connections);
  closeModal(); renderSidebar('');
}

async function deleteConn(id) {
  const conn = connections.find(c => c.id === id);
  showConfirmModal('Delete Connection', `Delete "${conn?.name || 'this connection'}"?`, async () => {
    connections = connections.filter(c => c.id !== id);
    await window.api.saveConnections(connections);
    closeModal();
    renderSidebar('');
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSize(b) {
  if (b===0) return '0 B'; if (b<1024) return b+' B';
  if (b<1048576) return (b/1024).toFixed(1)+' KB';
  if (b<1073741824) return (b/1048576).toFixed(1)+' MB';
  return (b/1073741824).toFixed(1)+' GB';
}
function joinPath(base, name) { return (base.replace(/\/$/,'')+'/'+name).replace(/\/+/g,'/'); }
function parentPath(p) { const parts=p.replace(/\/$/,'').split('/'); parts.pop(); return parts.join('/')||'/'; }
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
