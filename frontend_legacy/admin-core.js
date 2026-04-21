/* ═══════════════════════════════════════════════════════════════════
   ATMOS V2.0 — Core Module
   API base, toast, auth, sidebar, panel nav, keyboard shortcuts, WebSocket
   ═══════════════════════════════════════════════════════════════════ */

const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:7860'
    : 'https://nikhil1776-gdrivefwd.hf.space';

// ─── Global State ───
let allLibFiles = [];
let selectedFiles = new Set();
let discoverResults = [];
let selectedDiscover = new Set();
let currentScope = 'channels';

// ─── Toast System ───
function toast(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${icons[type] || ''} ${msg}</span><div class="toast-progress"></div>`;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.add('exit'); setTimeout(() => t.remove(), 300); }, 4000);
}

function isInputFocused() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function refreshIcons() {
    if (window.lucide) lucide.createIcons();
}

// ─── Auth Gate ───
function initAuth() {
    const overlay = document.getElementById('authOverlay');
    const passInput = document.getElementById('passInput');
    const loginBtn = document.getElementById('loginBtn');
    const errEl = document.getElementById('authError');

    // Check for saved HMAC token
    const savedToken = sessionStorage.getItem('atmos_admin_token');
    if (savedToken) {
        overlay.classList.add('hidden');
        return;
    }

    // Fallback: check old-style password
    const savedPass = sessionStorage.getItem('atmos_admin_pass');
    if (savedPass) {
        overlay.classList.add('hidden');
        return;
    }

    loginBtn?.addEventListener('click', attemptLogin);
    passInput?.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });

    async function attemptLogin() {
        const pass = passInput?.value?.trim();
        if (!pass) return;
        try {
            // Use new HMAC login endpoint
            const res = await fetch(`${API_BASE}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pass }),
            });
            if (res.ok) {
                const data = await res.json();
                sessionStorage.setItem('atmos_admin_token', data.token);
                sessionStorage.setItem('atmos_admin_pass', pass); // backwards compat
                overlay.classList.add('hidden');
                errEl.classList.remove('show');
                bootDashboard();
            } else {
                errEl.classList.add('show');
            }
        } catch (e) {
            // Fallback for dev mode
            sessionStorage.setItem('atmos_admin_pass', pass);
            overlay.classList.add('hidden');
            bootDashboard();
        }
    }
}

// ─── Authenticated Fetch (global) ───
// Attaches Bearer token (preferred) or password header to all admin API calls.
function authFetch(url, opts = {}) {
    const token = sessionStorage.getItem('atmos_admin_token');
    const pass = sessionStorage.getItem('atmos_admin_pass') || '';
    opts.headers = {
        ...opts.headers,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        'X-Admin-Password': pass,
    };
    return fetch(url, opts);
}

// ─── Sidebar ───
function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('sidebarCollapseBtn');
    btn?.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    document.getElementById('mobileMenuBtn')?.addEventListener('click', () => sidebar.classList.toggle('mobile-open'));
    document.addEventListener('keydown', e => {
        if (e.key === '[' && !isInputFocused()) sidebar.classList.toggle('collapsed');
    });
}

// ─── Panel Navigation ───
const PANEL_TITLES = {
    'panel-overview': 'Overview',
    'panel-discover': 'Discover',
    'panel-library': 'Library',
    'panel-transfers': 'Active Jobs',
    'panel-drive': 'Drive Explorer',
    'panel-bulk': 'Bulk Operations',
    'panel-scheduler': 'Scheduler',
    'panel-console': 'Console',
    'panel-health': 'Health Monitor',
    'panel-analytics': 'Analytics',
    'panel-feed': 'Activity Feed',
    'panel-telegram': 'Telegram',
    'panel-config': 'Config',
    'panel-appearance': 'Appearance'
};

function initPanelNav() {
    document.querySelectorAll('.nav-item[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            const panel = document.getElementById(btn.dataset.panel);
            if (panel) panel.classList.add('active');
            document.getElementById('panelTitle').textContent = PANEL_TITLES[btn.dataset.panel] || 'Panel';
            document.getElementById('sidebar')?.classList.remove('mobile-open');
        });
    });
}

// ─── Keyboard Shortcuts ───
function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        if (isInputFocused()) return;
        if (e.key === '?') {
            const o = document.getElementById('shortcutsOverlay');
            o.style.display = o.style.display === 'none' ? '' : 'none';
        }
        if (e.key === 'Escape') document.getElementById('shortcutsOverlay').style.display = 'none';
        if (e.key === 'r' || e.key === 'R') {
            if (typeof loadOverview === 'function') loadOverview();
            if (typeof loadLibrary === 'function') loadLibrary();
            toast('Refreshed', 'info');
        }
        if (e.key === '/') { e.preventDefault(); document.getElementById('librarySearch')?.focus(); }
        const panels = document.querySelectorAll('.nav-item[data-panel]');
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9 && panels[num - 1]) panels[num - 1].click();
    });
}

// ─── WebSocket (with proper cleanup) ───
let _ws = null;
let _wsRetryCount = 0;
let _wsPollingFallback = null;
let _wsKeepaliveId = null; // Track keepalive interval to avoid leaks

let _wsConnectedAt = 0; // Track when WS connected to detect flapping

function initWebSocket() {
    const wsBase = API_BASE.replace(/^http/, 'ws');
    const url = `${wsBase}/ws/admin`;

    try {
        _ws = new WebSocket(url);

        _ws.onopen = () => {
            console.log('🔌 WebSocket connected');
            _wsConnectedAt = Date.now();
            // Only reset retry if we stayed connected for >5 seconds last time
            // This prevents flapping from resetting the backoff
            if (_wsRetryCount > 0) {
                setTimeout(() => {
                    if (_ws && _ws.readyState === WebSocket.OPEN) {
                        _wsRetryCount = 0;
                    }
                }, 5000);
            } else {
                _wsRetryCount = 0;
            }
            if (_wsPollingFallback) { clearInterval(_wsPollingFallback); _wsPollingFallback = null; }
            const indicator = document.getElementById('wsIndicator');
            if (indicator) { indicator.style.background = '#22c55e'; indicator.title = 'Live connection'; }

            // Clear old keepalive before creating new one (prevents leak)
            if (_wsKeepaliveId) clearInterval(_wsKeepaliveId);
            _wsKeepaliveId = setInterval(() => {
                if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send('ping');
            }, 30000);
        };

        _ws.onmessage = (event) => {
            try { handleWsEvent(JSON.parse(event.data)); } catch (e) { console.warn('WS parse error:', e); }
        };

        _ws.onclose = () => {
            console.log('🔌 WebSocket disconnected');
            const indicator = document.getElementById('wsIndicator');
            if (indicator) { indicator.style.background = '#ef4444'; indicator.title = 'Disconnected'; }
            if (_wsKeepaliveId) { clearInterval(_wsKeepaliveId); _wsKeepaliveId = null; }

            // If connection was very short (<5s), it's flapping — increase backoff
            const uptime = Date.now() - _wsConnectedAt;
            if (uptime < 5000) _wsRetryCount++;

            const delay = Math.min(3000 * Math.pow(1.5, _wsRetryCount), 60000);
            setTimeout(initWebSocket, delay);
            if (!_wsPollingFallback) {
                _wsPollingFallback = setInterval(() => {
                    if (typeof loadOverview === 'function') loadOverview();
                }, 15000);
            }
        };

        _ws.onerror = () => {};
    } catch (e) {
        console.warn('WebSocket init failed, falling back to polling');
        if (!_wsPollingFallback) {
            _wsPollingFallback = setInterval(() => {
                if (typeof loadOverview === 'function') loadOverview();
            }, 15000);
        }
    }
}

function handleWsEvent(data) {
    switch (data.type) {
        case 'connected':
            toast(`⚡ Live connection — ${data.queue_size} jobs queued`, 'success');
            break;
        case 'job_start':
            toast(`🔽 Started: ${data.name} (${data.size})`, 'info');
            if (typeof loadOverview === 'function') loadOverview();
            break;
        case 'job_complete':
            toast(`✅ Complete: ${data.name} in ${data.elapsed}s`, 'success');
            if (typeof loadOverview === 'function') loadOverview();
            if (typeof loadLibrary === 'function') loadLibrary();
            break;
        case 'job_failed':
            toast(`❌ Failed: ${data.name} — ${data.error}`, 'error');
            if (typeof loadOverview === 'function') loadOverview();
            break;
        case 'pong':
            break;
    }
}

// ─── Refresh All Button ───
function initRefreshAll() {
    document.getElementById('refreshAllBtn')?.addEventListener('click', () => {
        if (typeof loadOverview === 'function') loadOverview();
        if (typeof loadLibrary === 'function') loadLibrary();
        if (typeof fetchConsoleLogs === 'function') fetchConsoleLogs();
        if (typeof loadBotInfo === 'function') loadBotInfo();
        toast('All data refreshed', 'info');
    });
}

// ─── Boot Sequence ───
function bootDashboard() {
    if (typeof loadOverview === 'function') loadOverview();
    if (typeof loadLibrary === 'function') loadLibrary();
    if (typeof loadBotInfo === 'function') loadBotInfo();
    if (typeof loadConfig === 'function') loadConfig();
    if (typeof fetchConsoleLogs === 'function') fetchConsoleLogs();
    if (typeof loadSourceChannels === 'function') loadSourceChannels();
    if (typeof initDiscover === 'function') initDiscover();
    if (typeof initTelegram === 'function') initTelegram();
    if (typeof initAnalytics === 'function') initAnalytics();
    if (typeof initAppearance === 'function') initAppearance();
    if (typeof initDriveExplorer === 'function') initDriveExplorer();
    if (typeof initBulkOps === 'function') initBulkOps();
    if (typeof initScheduler === 'function') initScheduler();
    if (typeof initHealth === 'function') initHealth();
    if (typeof initActivityFeed === 'function') initActivityFeed();
    initWebSocket();
    refreshIcons();
    // Fallback console polling
    setInterval(() => { if (typeof fetchConsoleLogs === 'function') fetchConsoleLogs(); }, 10000);
}

// ─── DOMContentLoaded ───
document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initPanelNav();
    initKeyboardShortcuts();
    initRefreshAll();
    refreshIcons();

    // Check for saved session — auto-boot if previously authenticated
    const savedPass = sessionStorage.getItem('atmos_admin_pass');
    if (savedPass) {
        document.getElementById('authOverlay')?.classList.add('hidden');
        bootDashboard();
    } else {
        initAuth();
    }
});
