/* ATMOS V3.0 — Admin Command Center Engine */
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:7860' : 'https://nikhil1776-gdrivefwd.hf.space';
let allLibFiles = [], selectedFiles = new Set(), discoverResults = [], selectedDiscover = new Set(), currentScope = 'channels';

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', () => {
    // Dev mode: skip auth
    document.getElementById('authOverlay').classList.add('hidden');
    initSidebar();
    initPanelNav();
    initKeyboardShortcuts();
    loadOverview();
    loadLibrary();
    loadBotInfo();
    loadConfig();
    fetchConsoleLogs();
    loadSourceChannels();
    initDiscover();
    initTelegram();
    initAnalytics();
    initAppearance();
    initWebSocket();
    if (window.lucide) lucide.createIcons();
    // Fallback polling (WS replaces most of this when connected)
    setInterval(fetchConsoleLogs, 10000);
});

// ═══ TOAST SYSTEM ═══
function toast(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${msg}</span><div class="toast-progress"></div>`;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('exit'); setTimeout(() => t.remove(), 300); }, 4000);
}

// ═══ SIDEBAR ═══
function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebarCollapseBtn');
    btn?.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    document.getElementById('mobileMenuBtn')?.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));
    // Keyboard: [ to toggle
    document.addEventListener('keydown', e => { if (e.key === '[' && !isInputFocused()) { sidebar.classList.toggle('collapsed'); } });
}

function isInputFocused() { const el = document.activeElement; return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'); }

// ═══ PANEL NAVIGATION ═══
function initPanelNav() {
    const titles = { 'panel-overview':'Overview','panel-discover':'Discover','panel-library':'Library','panel-transfers':'Active Jobs','panel-drive':'Drive Explorer','panel-bulk':'Bulk Operations','panel-scheduler':'Scheduler','panel-console':'Console','panel-health':'Health Monitor','panel-analytics':'Analytics','panel-feed':'Activity Feed','panel-telegram':'Telegram','panel-config':'Config','panel-appearance':'Appearance' };
    document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            const panel = document.getElementById(btn.dataset.panel);
            if (panel) panel.classList.add('active');
            document.getElementById('panelTitle').textContent = titles[btn.dataset.panel] || 'Panel';
            // Close mobile
            document.getElementById('sidebar')?.classList.remove('mobile-open');
        });
    });
}

// ═══ KEYBOARD SHORTCUTS ═══
function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        if (isInputFocused()) return;
        if (e.key === '?') { const o = document.getElementById('shortcutsOverlay'); o.style.display = o.style.display === 'none' ? '' : 'none'; }
        if (e.key === 'Escape') document.getElementById('shortcutsOverlay').style.display = 'none';
        if (e.key === 'r' || e.key === 'R') { loadOverview(); loadLibrary(); toast('Refreshed', 'info'); }
        if (e.key === '/') { e.preventDefault(); document.getElementById('librarySearch')?.focus(); }
        // Number keys for panels
        const panels = document.querySelectorAll('.nav-item[data-panel]');
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9 && panels[num-1]) panels[num-1].click();
    });
}

// ═══ OVERVIEW ═══
async function loadOverview() {
    try {
        const [sysRes, vidRes] = await Promise.all([
            fetch(`${API_BASE}/api/admin/system`).catch(() => null),
            fetch(`${API_BASE}/api/videos`).catch(() => null)
        ]);
        if (sysRes?.ok) {
            const sys = await sysRes.json();
            animateCounter('m-files', sys.total_files || 0);
            document.getElementById('m-size').textContent = sys.total_size || '—';
            document.getElementById('m-quota').textContent = sys.storage_used || '—';
            document.getElementById('m-quota-pct').textContent = sys.storage_percent ? `${sys.storage_percent}% used` : '—';
            const bar = document.getElementById('storageBar');
            if (bar) bar.style.width = `${sys.storage_percent || 0}%`;
            animateCounter('m-transfers', sys.active_transfers || 0);
            document.getElementById('m-queue').textContent = `${sys.queue_size || 0} queued`;
            animateCounter('m-views', sys.views || 0);
            animateCounter('m-streams', sys.streams || 0);
            document.getElementById('m-uptime').textContent = sys.uptime || '—';
            document.getElementById('uptimeDisplay').innerHTML = `<i data-lucide="clock"></i> ${sys.uptime || '--:--'}`;
            // Status pills
            setStatus('statusBot', sys.bot_running);
            setStatus('statusDrive', sys.drive_connected);
            setStatus('statusAPI', true);
            document.getElementById('connectionDot').className = 'connection-dot green';
            document.getElementById('connectionText').textContent = 'Connected';
            // Live transfers
            renderLiveTransfers(sys.active_jobs || []);
            // Update health if available
            if (sys.cpu_percent !== undefined) updateHealth(sys);
        }
        if (window.lucide) lucide.createIcons();
    } catch(e) { console.error('Overview load failed:', e); }
}

function animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;
    gsap.to({ val: current }, { val: target, duration: 1, ease: 'power2.out', onUpdate: function() { el.textContent = Math.round(this.targets()[0].val); } });
}

function setStatus(id, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    const dot = el.querySelector('.pulse-dot');
    if (dot) { dot.className = ok ? 'pulse-dot green' : 'pulse-dot'; }
}

function renderLiveTransfers(jobs) {
    const c = document.getElementById('liveTransfersContainer');
    if (!jobs.length) { c.innerHTML = '<div class="empty-box">No active transfers.</div>'; return; }
    c.innerHTML = jobs.map(j => `<div class="transfer-card"><div class="transfer-card-icon"><i data-lucide="cloud-upload"></i></div><div class="transfer-card-info"><div class="transfer-card-name">${j.filename || j.name || 'Unknown'}</div><div class="transfer-card-meta">${j.status || ''} • ${j.progress || 0}%</div><div class="transfer-progress"><div class="transfer-progress-bar" style="width:${j.progress||0}%"></div></div></div></div>`).join('');
}

// ═══ LIBRARY ═══
async function loadLibrary() {
    try {
        const res = await fetch(`${API_BASE}/api/videos`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        allLibFiles = data.videos || data.files || [];
        document.getElementById('fileCount').textContent = allLibFiles.length;
        renderLibraryTable(allLibFiles);
    } catch(e) { console.error('Library failed:', e); }
}

function renderLibraryTable(files) {
    const body = document.getElementById('fileTableBody');
    if (!files.length) { body.innerHTML = '<tr><td colspan="6" class="loading-cell">No files found.</td></tr>'; return; }
    body.innerHTML = files.map((f, i) => {
        const ext = (f.name || '').split('.').pop().toUpperCase();
        return `<tr data-id="${f.id}"><td>${i+1}</td><td title="${f.name}">${f.title || f.name}</td><td><span class="discover-result-quality" style="background:var(--bg-glass)">${ext}</span></td><td>${f.size || '—'}</td><td>${f.modified || '—'}</td><td><button class="tool-btn-sm" onclick="renameFile('${f.id}','${(f.name||'').replace(/'/g,"\\'")}')"><i data-lucide="edit-3"></i></button> <button class="tool-btn-sm" onclick="deleteFile('${f.id}')"><i data-lucide="trash-2"></i></button></td></tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

// Library search
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('librarySearch')?.addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        const filtered = q ? allLibFiles.filter(f => (f.title||f.name||'').toLowerCase().includes(q)) : allLibFiles;
        renderLibraryTable(filtered);
    });
    document.getElementById('btnAutoRename')?.addEventListener('click', autoRenameAll);
    document.getElementById('btnUndoRename')?.addEventListener('click', undoRenameAll);
    document.getElementById('btnRefreshLib')?.addEventListener('click', () => { loadLibrary(); toast('Library refreshed', 'info'); });
    document.getElementById('btnShareAll')?.addEventListener('click', shareAll);
});

async function autoRenameAll() {
    if (!confirm('This will scan all Drive files and attempt to auto-rename messy filenames using TMDB. This may take a while depending on library size. Continue?')) return;
    const btn = document.getElementById('btnAutoRename');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Processing...';
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/api/admin/auto-rename`, { method: 'POST', headers: {'Content-Type':'application/json'} });
        if (!res.ok) throw new Error('Auto-rename failed');
        const data = await res.json();
        toast(`✅ Auto-rename complete: ${data.renamed} renamed, ${data.skipped} skipped.`, 'success');
        if (data.renamed > 0) loadLibrary();
        console.log('Auto-rename details:', data.details);
    } catch(e) { 
        toast('Error: ' + e.message, 'error'); 
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        if (window.lucide) lucide.createIcons();
    }
}

async function undoRenameAll() {
    if (!confirm('This will restore all files in Google Drive to their original uploaded filenames (undoing any manual or auto-renames). Continue?')) return;
    const btn = document.getElementById('btnUndoRename');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Reverting...';
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/api/admin/undo-rename`, { method: 'POST', headers: {'Content-Type':'application/json'} });
        if (!res.ok) throw new Error('Undo rename failed');
        const data = await res.json();
        toast(`✅ Undo complete: ${data.restored} restored, ${data.skipped} skipped.`, 'success');
        if (data.restored > 0) loadLibrary();
    } catch(e) { 
        toast('Error: ' + e.message, 'error'); 
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        if (window.lucide) lucide.createIcons();
    }
}

async function renameFile(id, oldName) {
    const newName = prompt('New filename:', oldName);
    if (!newName || newName === oldName) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/rename/${id}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({new_name: newName}) });
        if (res.ok) { toast('Renamed!', 'success'); loadLibrary(); } else toast('Rename failed', 'error');
    } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteFile(id) {
    if (!confirm('Delete this file permanently?')) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/delete/${id}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) });
        if (res.ok) { toast('Deleted', 'success'); loadLibrary(); } else toast('Delete failed', 'error');
    } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function shareAll() {
    if (!confirm('Make ALL Drive files publicly accessible?')) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/share-all`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) });
        if (res.ok) { toast('All files shared!', 'success'); } else toast('Share failed', 'error');
    } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ═══ DISCOVER ═══
function initDiscover() {
    const search = document.getElementById('discoverSearch');
    let timer;
    search?.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); runDiscover(); } });
    search?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runDiscover, 500); });

    // Scope tabs
    document.querySelectorAll('.dtab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('.dtab').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            currentScope = t.dataset.scope;
        });
    });

    // Quality filter
    document.getElementById('qualityFilter')?.addEventListener('change', () => renderDiscoverResults());

    // Batch pull
    document.getElementById('btnPullBatch')?.addEventListener('click', pullBatch);
}

async function runDiscover() {
    const q = document.getElementById('discoverSearch')?.value.trim();
    if (!q) return;
    const endpoint = currentScope === 'global' ? '/api/admin/channel-search-global' : '/api/admin/channel-search';
    const container = document.getElementById('discoverResults');
    container.innerHTML = '<div class="discover-placeholder"><div class="loading-spinner"></div><p>Searching...</p></div>';
    try {
        const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ query: q, limit: 50 }) });
        const data = await res.json();
        discoverResults = data.results || [];
        selectedDiscover.clear();
        renderDiscoverResults();
        // Save to search history
        saveSearchHistory(q);
    } catch(e) { container.innerHTML = `<div class="discover-placeholder"><p>Search failed: ${e.message}</p></div>`; }
}

function renderDiscoverResults() {
    const filter = document.getElementById('qualityFilter')?.value || 'all';
    let results = [...discoverResults];
    if (filter !== 'all') results = results.filter(r => (r.quality || '').includes(filter));
    document.getElementById('discoverResultCount').textContent = `${results.length} results`;
    const c = document.getElementById('discoverResults');
    if (!results.length) { c.innerHTML = '<div class="discover-placeholder"><p>No results found.</p></div>'; return; }
    c.innerHTML = results.map((r, i) => {
        const sel = selectedDiscover.has(i) ? ' selected' : '';
        const qColor = r.quality?.includes('2160') ? 'background:#FBBF24;color:#000' : r.quality?.includes('1080') ? 'background:#22C55E;color:#000' : 'background:var(--bg-glass)';
        return `<div class="discover-result${sel}" data-i="${i}" onclick="toggleDiscoverSelect(${i})"><div class="discover-result-check">${sel ? '✓' : ''}</div><div class="discover-result-info"><div class="discover-result-name">${r.filename || r.name || 'Unknown'}</div><div class="discover-result-meta">${r.size || ''} • ${r.channel || ''}</div></div><span class="discover-result-quality" style="${qColor}">${r.quality || '?'}</span></div>`;
    }).join('');
    updateBatchBar();
}

function toggleDiscoverSelect(i) {
    if (selectedDiscover.has(i)) selectedDiscover.delete(i); else selectedDiscover.add(i);
    renderDiscoverResults();
}

function updateBatchBar() {
    const bar = document.getElementById('batchBar');
    const count = document.getElementById('batchCount');
    if (selectedDiscover.size > 0) { bar.style.display = 'flex'; count.textContent = `${selectedDiscover.size} selected`; }
    else { bar.style.display = 'none'; }
}

async function pullBatch() {
    const items = [...selectedDiscover].map(i => discoverResults[i]).filter(Boolean);
    if (!items.length) return;
    toast(`Pulling ${items.length} files...`, 'info');
    try {
        const res = await fetch(`${API_BASE}/api/admin/pull-batch`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ files: items }) });
        if (res.ok) { toast('Batch pull started!', 'success'); selectedDiscover.clear(); updateBatchBar(); }
        else toast('Pull failed', 'error');
    } catch(e) { toast('Error: ' + e.message, 'error'); }
}

function saveSearchHistory(q) {
    const hist = JSON.parse(localStorage.getItem('atmos_search_history') || '[]');
    if (!hist.includes(q)) { hist.unshift(q); if (hist.length > 20) hist.pop(); localStorage.setItem('atmos_search_history', JSON.stringify(hist)); }
}

// ═══ SOURCE CHANNELS ═══
async function loadSourceChannels() {
    try {
        const res = await fetch(`${API_BASE}/api/admin/source-channels`);
        if (!res.ok) return;
        const data = await res.json();
        renderChannelChips(data.channels || []);
    } catch(e) {}
}

function renderChannelChips(channels) {
    const c = document.getElementById('channelList');
    c.innerHTML = channels.map(ch => `<div class="channel-chip"><span>${ch}</span><span class="channel-chip-remove" onclick="removeChannel('${ch}')"><i data-lucide="x"></i></span></div>`).join('');
    if (window.lucide) lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnAddChannel')?.addEventListener('click', async () => {
        const input = document.getElementById('newChannelInput');
        const ch = input.value.trim();
        if (!ch) return;
        try {
            await fetch(`${API_BASE}/api/admin/source-channels`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'add', channel: ch }) });
            input.value = '';
            loadSourceChannels();
            toast(`Added ${ch}`, 'success');
        } catch(e) { toast('Failed to add', 'error'); }
    });
});

async function removeChannel(ch) {
    try {
        await fetch(`${API_BASE}/api/admin/source-channels`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action: 'remove', channel: ch }) });
        loadSourceChannels();
        toast(`Removed ${ch}`, 'info');
    } catch(e) {}
}

// ═══ CONSOLE ═══
async function fetchConsoleLogs() {
    try {
        const res = await fetch(`${API_BASE}/api/admin/logs`);
        if (!res.ok) return;
        const data = await res.json();
        const output = document.getElementById('consoleOutput');
        const shouldScroll = document.getElementById('consoleAutoScroll')?.checked;
        const lines = (data.logs || []).join('\n');
        output.textContent = lines;
        if (shouldScroll) output.scrollTop = output.scrollHeight;
    } catch(e) {}
}

// Console filter logic moved to bottom — full implementation

// ═══ TELEGRAM ═══
function initTelegram() {
    const textarea = document.getElementById('tgMessageInput');
    textarea?.addEventListener('input', () => {
        document.getElementById('tgCharCount').textContent = `${textarea.value.length}/4096`;
    });

    document.querySelectorAll('.template-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (textarea) textarea.value = btn.dataset.msg;
            document.getElementById('tgCharCount').textContent = `${btn.dataset.msg.length}/4096`;
        });
    });

    document.getElementById('btnSendTelegram')?.addEventListener('click', async () => {
        const msg = textarea?.value.trim();
        if (!msg) return;
        try {
            const res = await fetch(`${API_BASE}/api/admin/telegram/send`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ message: msg }) });
            if (res.ok) { toast('Message sent!', 'success'); textarea.value = ''; }
            else toast('Send failed', 'error');
        } catch(e) { toast('Error: ' + e.message, 'error'); }
    });
}

async function loadBotInfo() {
    try {
        const res = await fetch(`${API_BASE}/api/admin/bot-info`);
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById('tgBotName').textContent = data.bot_name || 'ATMOS Bot';
        document.getElementById('tgBotStatus').textContent = data.bot_running ? '✅ Running' : '❌ Offline';
        document.getElementById('tgAllowedUser').textContent = data.allowed_user || '—';
        document.getElementById('tgQueueSize').textContent = `${data.queue_size || 0} items`;
        document.getElementById('tgWorkerStatus').textContent = data.worker_status || '—';
    } catch(e) {}
}

// ═══ ANALYTICS ═══
let viewsChart = null;
function initAnalytics() {
    document.getElementById('btnResetAnalytics')?.addEventListener('click', async () => {
        if (!confirm('Reset all analytics data?')) return;
        try { await fetch(`${API_BASE}/api/admin/analytics/reset`, { method: 'POST' }); toast('Analytics reset', 'success'); } catch(e) {}
    });
    // Init chart
    const ctx = document.getElementById('viewsChart');
    if (ctx && window.Chart) {
        viewsChart = new Chart(ctx, {
            type: 'line', data: { labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], datasets: [{ label: 'Views', data: [0,0,0,0,0,0,0], borderColor: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.1)', fill: true, tension: 0.4, pointRadius: 3 }] },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94A3B8' } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94A3B8' } } } }
        });
    }
}

// ═══ CONFIG ═══
async function loadConfig() {
    try {
        const res = await fetch(`${API_BASE}/api/admin/config`);
        if (!res.ok) return;
        const data = await res.json();
        const body = document.getElementById('configTableBody');
        const secrets = data.config || data;
        body.innerHTML = Object.entries(secrets).map(([k,v]) => `<tr><td><code>${k}</code></td><td>${v ? '<span style="color:var(--accent-green)">✅ Set</span>' : '<span style="color:var(--accent-red)">❌ Missing</span>'}</td></tr>`).join('');
    } catch(e) {}
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnClearQueue')?.addEventListener('click', async () => {
        if (!confirm('Clear all pending transfers?')) return;
        try { await fetch(`${API_BASE}/api/admin/clear_queue`, { method: 'POST' }); toast('Queue cleared', 'success'); } catch(e) {}
    });
    document.getElementById('btnRestartServer')?.addEventListener('click', async () => {
        if (!confirm('Restart the backend server?')) return;
        try { await fetch(`${API_BASE}/api/admin/restart`, { method: 'POST' }); toast('Restarting...', 'warning'); } catch(e) {}
    });
    document.getElementById('btnShareAllConfig')?.addEventListener('click', shareAll);
    document.getElementById('btnReorgDrive')?.addEventListener('click', async () => {
        if (!confirm('Reorganize Drive files into folders?')) return;
        try { await fetch(`${API_BASE}/api/admin/reorganize`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) }); toast('Reorganizing...', 'info'); } catch(e) {}
    });
});

// ═══ HEALTH MONITOR ═══
function updateHealth(sys) {
    updateGauge('gaugeCPUFill', 'gaugeCPUVal', sys.cpu_percent || 0);
    updateGauge('gaugeRAMFill', 'gaugeRAMVal', sys.memory_percent || 0);
    updateGauge('gaugeDiskFill', 'gaugeDiskVal', sys.disk_percent || 0);
    const lat = document.getElementById('healthLatency');
    if (lat) lat.textContent = `${sys.api_latency || '—'} ms`;
}

function updateGauge(fillId, valId, pct) {
    const fill = document.getElementById(fillId);
    const val = document.getElementById(valId);
    if (fill) { const circ = 2 * Math.PI * 54; fill.style.strokeDashoffset = circ - (circ * pct / 100); }
    if (val) val.textContent = `${Math.round(pct)}%`;
}

// ═══ APPEARANCE ═══
function initAppearance() {
    const themes = { obsidian: { bg: '#050814', accent: '#FBBF24' }, midnight: { bg: '#0a1628', accent: '#3B82F6' }, neon: { bg: '#0B0F1A', accent: '#FF2D95' }, emerald: { bg: '#052e16', accent: '#22C55E' } };

    document.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const t = themes[card.dataset.theme];
            if (t) { document.documentElement.style.setProperty('--bg-deep', t.bg); document.documentElement.style.setProperty('--accent', t.accent); }
            localStorage.setItem('atmos_theme', card.dataset.theme);
        });
    });

    document.querySelectorAll('.accent-swatch').forEach(s => {
        s.addEventListener('click', () => {
            document.querySelectorAll('.accent-swatch').forEach(x => x.classList.remove('active'));
            s.classList.add('active');
            document.documentElement.style.setProperty('--accent', s.dataset.color);
            localStorage.setItem('atmos_accent', s.dataset.color);
        });
    });

    document.getElementById('settingCompact')?.addEventListener('change', e => {
        document.getElementById('sidebar')?.classList.toggle('collapsed', e.target.checked);
    });

    // Restore saved
    const savedTheme = localStorage.getItem('atmos_theme');
    if (savedTheme) document.querySelector(`.theme-card[data-theme="${savedTheme}"]`)?.click();
    const savedAccent = localStorage.getItem('atmos_accent');
    if (savedAccent) document.querySelector(`.accent-swatch[data-color="${savedAccent}"]`)?.click();
}

// ═══ REFRESH ═══
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('refreshAllBtn')?.addEventListener('click', () => {
        loadOverview(); loadLibrary(); fetchConsoleLogs(); loadBotInfo();
        toast('All data refreshed', 'info');
    });
});

// ═══ DRIVE EXPLORER ═══
let driveBreadcrumb = [];
function initDriveExplorer() {
    document.getElementById('btnDriveRefresh')?.addEventListener('click', () => browseDrive());
    document.getElementById('btnDriveNewFolder')?.addEventListener('click', createDriveFolder);
    browseDrive();
}

async function browseDrive(folderId) {
    const list = document.getElementById('driveFileList');
    if (!list) return;
    list.innerHTML = '<div class="discover-placeholder"><p>Loading...</p></div>';
    try {
        const url = folderId ? `${API_BASE}/api/admin/drive/browse?folder_id=${folderId}` : `${API_BASE}/api/admin/drive/browse`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) { list.innerHTML = `<div class="discover-placeholder"><p>${data.error}</p></div>`; return; }
        if (folderId && !driveBreadcrumb.find(b => b.id === folderId)) {
            driveBreadcrumb.push({ id: folderId, name: folderId.slice(0,8)+'...' });
        }
        renderBreadcrumb();
        const files = data.files || [];
        if (!files.length) { list.innerHTML = '<div class="discover-placeholder"><p>Empty folder</p></div>'; return; }
        list.innerHTML = files.map(f => {
            const icon = f.is_folder ? 'folder' : 'file-video';
            const click = f.is_folder ? `onclick="browseDrive('${f.id}')"` : '';
            return `<div class="drive-item" ${click}><div class="drive-item-icon"><i data-lucide="${icon}"></i></div><div class="drive-item-name">${f.name}</div><div class="drive-item-size">${f.size || ''}</div></div>`;
        }).join('');
        if (window.lucide) lucide.createIcons();
    } catch(e) { list.innerHTML = `<div class="discover-placeholder"><p>Error: ${e.message}</p></div>`; }
}

function renderBreadcrumb() {
    const bc = document.getElementById('driveBreadcrumb');
    if (!bc) return;
    let html = `<span class="bc-item active" onclick="driveBreadcrumb=[];browseDrive()">Root</span>`;
    driveBreadcrumb.forEach((b, i) => {
        html += ` <span style="color:var(--text-muted)">›</span> <span class="bc-item${i===driveBreadcrumb.length-1?' active':''}" onclick="driveBreadcrumb=driveBreadcrumb.slice(0,${i+1});browseDrive('${b.id}')">${b.name}</span>`;
    });
    bc.innerHTML = html;
}

async function createDriveFolder() {
    const name = prompt('New folder name:');
    if (!name) return;
    const parentId = driveBreadcrumb.length ? driveBreadcrumb[driveBreadcrumb.length-1].id : '';
    try {
        const body = { name };
        if (parentId) body.parent_id = parentId;
        const res = await fetch(`${API_BASE}/api/admin/drive/mkdir`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        if (res.ok) { toast('Folder created!','success'); browseDrive(parentId||undefined); }
        else { const d = await res.json(); toast(d.error||'Failed','error'); }
    } catch(e) { toast('Error: '+e.message,'error'); }
}

// ═══ BULK OPERATIONS ═══
function initBulkOps() {
    document.getElementById('btnBulkPreview')?.addEventListener('click', previewBulkRename);
    document.getElementById('btnBulkApply')?.addEventListener('click', applyBulkRename);
    document.getElementById('btnBulkDelete')?.addEventListener('click', applyBulkDelete);
}

function previewBulkRename() {
    const find = document.getElementById('bulkFind')?.value;
    const replace = document.getElementById('bulkReplace')?.value ?? '';
    const useRegex = document.getElementById('bulkRegex')?.checked;
    if (!find) { toast('Enter a find pattern','warning'); return; }
    const preview = document.getElementById('bulkPreview');
    if (!preview) return;
    let lines = [];
    allLibFiles.forEach(f => {
        const name = f.name || '';
        let newName;
        try {
            newName = useRegex ? name.replace(new RegExp(find,'gi'), replace) : name.split(find).join(replace);
        } catch(e) { newName = name; }
        if (newName !== name) lines.push(`${name}\n  → ${newName}`);
    });
    preview.textContent = lines.length ? lines.join('\n\n') : 'No matches found.';
}

async function applyBulkRename() {
    const find = document.getElementById('bulkFind')?.value;
    const replace = document.getElementById('bulkReplace')?.value ?? '';
    const useRegex = document.getElementById('bulkRegex')?.checked;
    if (!find) return;
    const renames = [];
    allLibFiles.forEach(f => {
        const name = f.name || '';
        let newName;
        try { newName = useRegex ? name.replace(new RegExp(find,'gi'), replace) : name.split(find).join(replace); } catch(e) { return; }
        if (newName !== name) renames.push({ id: f.id, new_name: newName });
    });
    if (!renames.length) { toast('No files to rename','info'); return; }
    if (!confirm(`Rename ${renames.length} files?`)) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/bulk/rename`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ renames }) });
        const d = await res.json();
        toast(`Renamed ${d.success} files${d.errors?.length ? `, ${d.errors.length} errors`:''}`, d.errors?.length ? 'warning' : 'success');
        loadLibrary();
    } catch(e) { toast('Error: '+e.message,'error'); }
}

async function applyBulkDelete() {
    if (!selectedFiles.size) { toast('Select files in Library first','warning'); return; }
    if (!confirm(`Delete ${selectedFiles.size} selected files permanently?`)) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/bulk/delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ file_ids: [...selectedFiles] }) });
        const d = await res.json();
        toast(`Deleted ${d.success} files`, 'success');
        selectedFiles.clear();
        loadLibrary();
    } catch(e) { toast('Error: '+e.message,'error'); }
}

// ═══ SCHEDULER ═══
function initScheduler() {
    document.getElementById('btnNewSchedule')?.addEventListener('click', () => {
        const form = document.getElementById('scheduleForm');
        if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('btnSaveSchedule')?.addEventListener('click', saveSchedule);
    loadSchedules();
}

async function loadSchedules() {
    const list = document.getElementById('schedulerList');
    if (!list) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/schedules`);
        const data = await res.json();
        const schedules = data.schedules || [];
        if (!schedules.length) { list.innerHTML = '<div class="empty-box">No schedules configured.</div>'; return; }
        list.innerHTML = schedules.map(s => `<div class="schedule-item"><div class="schedule-item-info"><div class="schedule-item-title">${s.query||'Untitled'} → ${s.channel||'—'}</div><div class="schedule-item-meta">Every ${Math.round(s.interval/3600)}h • Quality: ${s.quality||'all'} • ${s.enabled?'✅ Active':'⏸ Paused'} • Last: ${s.last_run||'Never'}</div></div><button class="tool-btn danger" onclick="deleteSchedule('${s.id}')"><i data-lucide="trash-2"></i></button></div>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch(e) { list.innerHTML = '<div class="empty-box">Failed to load schedules.</div>'; }
}

async function saveSchedule() {
    const channel = document.getElementById('schedChannel')?.value.trim();
    const query = document.getElementById('schedQuery')?.value.trim();
    const interval = parseInt(document.getElementById('schedInterval')?.value || '86400');
    const quality = document.getElementById('schedQuality')?.value || 'all';
    if (!channel || !query) { toast('Channel and query required','warning'); return; }
    try {
        const res = await fetch(`${API_BASE}/api/admin/schedules`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ channel, query, interval, quality }) });
        if (res.ok) { toast('Schedule created!','success'); loadSchedules(); document.getElementById('scheduleForm').style.display='none'; }
        else toast('Failed to save','error');
    } catch(e) { toast('Error: '+e.message,'error'); }
}

async function deleteSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    try {
        await fetch(`${API_BASE}/api/admin/schedules/delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }) });
        toast('Schedule deleted','info');
        loadSchedules();
    } catch(e) {}
}

// ═══ HEALTH MONITOR (independent polling) ═══
let healthInterval = null;
function initHealth() {
    pollHealth();
    // Only poll when panel is visible
    const observer = new MutationObserver(() => {
        const panel = document.getElementById('panel-health');
        if (panel?.classList.contains('active') && !healthInterval) {
            healthInterval = setInterval(pollHealth, 5000);
        } else if (!panel?.classList.contains('active') && healthInterval) {
            clearInterval(healthInterval); healthInterval = null;
        }
    });
    const panels = document.querySelector('.main-content');
    if (panels) observer.observe(panels, { subtree: true, attributes: true, attributeFilter: ['class'] });
}

async function pollHealth() {
    try {
        const res = await fetch(`${API_BASE}/api/admin/health`);
        if (!res.ok) return;
        const h = await res.json();
        updateGauge('gaugeCPUFill', 'gaugeCPUVal', h.cpu_percent || 0);
        updateGauge('gaugeRAMFill', 'gaugeRAMVal', h.memory_percent || 0);
        updateGauge('gaugeDiskFill', 'gaugeDiskVal', h.disk_percent || 0);
        const lat = document.getElementById('healthLatency');
        if (lat) lat.textContent = `${h.api_latency_ms || '—'} ms`;
        // Info grid
        const info = document.getElementById('healthInfo');
        if (info) info.innerHTML = [
            ['Python', h.python_version||'—'], ['Platform', h.platform||'—'],
            ['Uptime', h.uptime_human||'—'], ['Memory', `${h.memory_used||'?'} / ${h.memory_total||'?'}`],
            ['Disk', `${h.disk_used||'?'} / ${h.disk_total||'?'}`], ['API Latency', `${h.api_latency_ms||'—'}ms`]
        ].map(([k,v]) => `<div class="feed-item"><div class="feed-text"><strong>${k}</strong><small>${v}</small></div></div>`).join('');
    } catch(e) {}
}

// ═══ ACTIVITY FEED ═══
let feedInterval = null;
function initActivityFeed() {
    loadActivityFeed();
    const observer = new MutationObserver(() => {
        const panel = document.getElementById('panel-feed');
        if (panel?.classList.contains('active') && !feedInterval) {
            feedInterval = setInterval(loadActivityFeed, 5000);
        } else if (!panel?.classList.contains('active') && feedInterval) {
            clearInterval(feedInterval); feedInterval = null;
        }
    });
    const panels = document.querySelector('.main-content');
    if (panels) observer.observe(panels, { subtree: true, attributes: true, attributeFilter: ['class'] });
}

async function loadActivityFeed() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/activity?limit=50`);
        const data = await res.json();
        const events = data.events || [];
        if (!events.length) { feed.innerHTML = '<div class="empty-box">No activity yet.</div>'; return; }
        const catClass = { stream:'stream', transfer:'transfer', error:'error', system:'stream', drive:'transfer', bulk:'transfer', scheduler:'stream' };
        feed.innerHTML = events.map(e => `<div class="feed-item"><div class="feed-icon ${catClass[e.category]||'stream'}">${e.icon||'📋'}</div><div class="feed-text"><strong>${e.text||''}</strong><small>${e.ts||''}</small></div></div>`).join('');
    } catch(e) {}
}

// ═══ CONSOLE LOG FILTERS (complete the stub) ═══
let allConsoleLogs = [];
const origFetchConsoleLogs = fetchConsoleLogs;
fetchConsoleLogs = async function() {
    try {
        const res = await fetch(`${API_BASE}/api/admin/logs`);
        if (!res.ok) return;
        const data = await res.json();
        allConsoleLogs = data.logs || [];
        applyConsoleFilter();
    } catch(e) {}
};

function applyConsoleFilter() {
    const activeBtn = document.querySelector('.log-filter.active');
    const filter = activeBtn?.dataset?.level || 'all';
    const output = document.getElementById('consoleOutput');
    if (!output) return;
    let lines = allConsoleLogs;
    if (filter === 'error') lines = lines.filter(l => /❌|error|Error|ERROR|traceback|Traceback/i.test(l));
    else if (filter === 'warn') lines = lines.filter(l => /⚠️|warn|Warning|WARNING/i.test(l));
    else if (filter === 'info') lines = lines.filter(l => /✅|INFO|info|Started|Running|Complete/i.test(l));
    output.textContent = lines.join('\n');
    const shouldScroll = document.getElementById('consoleAutoScroll')?.checked;
    if (shouldScroll) output.scrollTop = output.scrollHeight;
}

// Wire up filter buttons properly
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.log-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.log-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyConsoleFilter();
        });
    });
});

// ═══ LIBRARY: Grid View + Bulk Select ═══
let libraryView = 'list';
document.addEventListener('DOMContentLoaded', () => {
    // Grid/List toggle
    document.querySelectorAll('.vt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            libraryView = btn.dataset.view || 'list';
            renderLibraryView();
        });
    });
    // Bulk select toggle
    document.getElementById('btnBulkSelect')?.addEventListener('click', () => {
        document.body.classList.toggle('select-mode');
        const active = document.body.classList.contains('select-mode');
        toast(active ? 'Select mode ON — click files to select' : 'Select mode OFF', 'info');
        if (!active) selectedFiles.clear();
        renderLibraryView();
    });
});

function renderLibraryView() {
    if (libraryView === 'grid') renderLibraryGrid(allLibFiles);
    else renderLibraryTable(allLibFiles);
}

function renderLibraryGrid(files) {
    const table = document.querySelector('.table-wrapper');
    const grid = document.getElementById('libraryGridView');
    if (table) table.style.display = 'none';
    if (!grid) return;
    grid.style.display = 'grid';
    if (!files.length) { grid.innerHTML = '<div class="empty-box">No files.</div>'; return; }
    grid.innerHTML = files.map(f => {
        const sel = selectedFiles.has(f.id) ? ' selected' : '';
        const poster = f.poster || f.thumbnail || '';
        const bg = poster ? `background-image:url('${poster}');background-size:cover;background-position:center;` : 'background:var(--bg-glass);';
        return `<div class="card${sel}" style="aspect-ratio:2/3;${bg}" onclick="toggleFileSelect('${f.id}')"><div class="card-overlay" style="opacity:1;background:linear-gradient(transparent 50%,rgba(0,0,0,0.85))"><div class="card-overlay-title">${f.title||f.name||''}</div><div class="card-overlay-meta">${f.size||''}</div></div></div>`;
    }).join('');
}

function toggleFileSelect(id) {
    if (!document.body.classList.contains('select-mode')) return;
    if (selectedFiles.has(id)) selectedFiles.delete(id); else selectedFiles.add(id);
    renderLibraryView();
    const counter = document.getElementById('fileCount');
    if (counter && selectedFiles.size) counter.textContent = `${selectedFiles.size} selected / ${allLibFiles.length}`;
    else if (counter) counter.textContent = allLibFiles.length;
}

// Override original renderLibraryTable to restore table visibility
const origRenderTable = renderLibraryTable;
renderLibraryTable = function(files) {
    const table = document.querySelector('.table-wrapper');
    const grid = document.getElementById('libraryGridView');
    if (table) table.style.display = '';
    if (grid) grid.style.display = 'none';
    origRenderTable(files);
};

// ═══ INIT ALL NEW PANELS ON LOAD ═══
document.addEventListener('DOMContentLoaded', () => {
    initDriveExplorer();
    initBulkOps();
    initScheduler();
    initHealth();
    initActivityFeed();
});

// ═══ WEBSOCKET — REAL-TIME ADMIN UPDATES ═══
let _ws = null;
let _wsRetryCount = 0;
let _wsPollingFallback = null;

function initWebSocket() {
    const wsBase = API_BASE.replace(/^http/, 'ws');
    const url = `${wsBase}/ws/admin`;
    
    try {
        _ws = new WebSocket(url);
        
        _ws.onopen = () => {
            console.log('🔌 WebSocket connected');
            _wsRetryCount = 0;
            // Clear fallback polling if WS is alive
            if (_wsPollingFallback) { clearInterval(_wsPollingFallback); _wsPollingFallback = null; }
            // Update connection indicator
            const indicator = document.getElementById('wsIndicator');
            if (indicator) { indicator.style.background = '#22c55e'; indicator.title = 'Live connection'; }
        };
        
        _ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWsEvent(data);
            } catch (e) { console.warn('WS parse error:', e); }
        };
        
        _ws.onclose = () => {
            console.log('🔌 WebSocket disconnected');
            const indicator = document.getElementById('wsIndicator');
            if (indicator) { indicator.style.background = '#ef4444'; indicator.title = 'Disconnected'; }
            // Reconnect with exponential backoff
            _wsRetryCount++;
            const delay = Math.min(3000 * Math.pow(1.5, _wsRetryCount), 30000);
            setTimeout(initWebSocket, delay);
            // Start fallback polling while disconnected
            if (!_wsPollingFallback) {
                _wsPollingFallback = setInterval(loadOverview, 15000);
            }
        };
        
        _ws.onerror = () => {};
        
        // Keepalive ping every 30s
        setInterval(() => {
            if (_ws && _ws.readyState === WebSocket.OPEN) {
                _ws.send('ping');
            }
        }, 30000);
        
    } catch (e) {
        console.warn('WebSocket init failed, falling back to polling');
        if (!_wsPollingFallback) {
            _wsPollingFallback = setInterval(loadOverview, 15000);
        }
    }
}

function handleWsEvent(data) {
    switch (data.type) {
        case 'connected':
            toast(`⚡ Live connection — ${data.queue_size} jobs queued`, 'success');
            break;
            
        case 'job_start':
            toast(`🔽 Worker-${data.worker} started: ${data.name} (${data.size})`, 'info');
            loadOverview();
            addActivityEntry('download', `Started: ${data.name}`, data.size);
            break;
            
        case 'job_complete':
            toast(`✅ Complete: ${data.name} in ${data.elapsed}s`, 'success');
            loadOverview();
            loadLibrary();
            addActivityEntry('complete', `Finished: ${data.name}`, `${data.size} in ${data.elapsed}s`);
            break;
            
        case 'job_failed':
            toast(`❌ Failed: ${data.name} — ${data.error}`, 'error');
            loadOverview();
            addActivityEntry('error', `Failed: ${data.name}`, data.error);
            break;
            
        case 'pong':
            break; // keepalive response
    }
}

function addActivityEntry(type, title, detail) {
    const feed = document.getElementById('activityList');
    if (!feed) return;
    const icons = { download: 'download', complete: 'check-circle', error: 'alert-triangle' };
    const colors = { download: '#3b82f6', complete: '#22c55e', error: '#ef4444' };
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'activity-entry';
    entry.style.cssText = `display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);margin-bottom:6px;animation:fadeIn 0.3s ease`;
    entry.innerHTML = `<div style="width:32px;height:32px;border-radius:8px;background:${colors[type]}20;display:flex;align-items:center;justify-content:center"><i data-lucide="${icons[type]}" style="width:16px;height:16px;color:${colors[type]}"></i></div><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">${title}</div><div style="font-size:11px;color:var(--text-muted)">${detail||''}</div></div><span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${time}</span>`;
    feed.prepend(entry);
    if (window.lucide) lucide.createIcons();
    // Cap at 50 entries
    while (feed.children.length > 50) feed.lastChild.remove();
}
