/* ═══════════════════════════════════════════════════════════════════
   ATMOS V2.0 — Monitoring Module
   Console (with real log filters), health gauges, analytics, activity feed
   ═══════════════════════════════════════════════════════════════════ */

// ─── Console Logs ───
let allConsoleLogs = [];

async function fetchConsoleLogs() {
    try {
        const res = await authFetch(`${API_BASE}/api/admin/logs`);
        if (!res.ok) return;
        const data = await res.json();
        allConsoleLogs = data.logs || [];
        applyConsoleFilter();
    } catch (e) { }
}

function applyConsoleFilter() {
    const activeBtn = document.querySelector('.log-filter.active');
    const filter = activeBtn?.dataset?.level || 'all';
    const output = document.getElementById('consoleOutput');
    if (!output) return;

    let lines = allConsoleLogs;
    if (filter === 'error') lines = lines.filter(l => /❌|error|Error|ERROR|traceback|Traceback|Exception/i.test(l));
    else if (filter === 'warn') lines = lines.filter(l => /⚠️|warn|Warning|WARNING/i.test(l));
    else if (filter === 'info') lines = lines.filter(l => /✅|INFO|info|Started|Running|Complete|Success/i.test(l));

    // Colorize lines
    output.innerHTML = lines.map(l => {
        let cls = 'log-line';
        if (/❌|error|Error|ERROR|Exception|traceback/i.test(l)) cls += ' log-error';
        else if (/⚠️|warn|Warning|WARNING/i.test(l)) cls += ' log-warn';
        else if (/✅|Complete|Success|Started|Running/i.test(l)) cls += ' log-info';
        return `<div class="${cls}">${escapeHtml(l)}</div>`;
    }).join('');

    const shouldScroll = document.getElementById('consoleAutoScroll')?.checked;
    if (shouldScroll) output.scrollTop = output.scrollHeight;

    // Update log count badge
    const logCount = document.getElementById('logCount');
    if (logCount) logCount.textContent = lines.length;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Wire up console filter buttons
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.log-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.log-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyConsoleFilter();
        });
    });

    document.getElementById('btnClearConsole')?.addEventListener('click', () => {
        allConsoleLogs = [];
        const output = document.getElementById('consoleOutput');
        if (output) output.innerHTML = '';
        toast('Console cleared', 'info');
    });
});

// ─── Health Monitor ───
let healthInterval = null;

function initHealth() {
    pollHealth();
    const observer = new MutationObserver(() => {
        const panel = document.getElementById('panel-health');
        if (panel?.classList.contains('active') && !healthInterval) {
            healthInterval = setInterval(pollHealth, 5000);
        } else if (!panel?.classList.contains('active') && healthInterval) {
            clearInterval(healthInterval);
            healthInterval = null;
        }
    });
    const panels = document.querySelector('.main-content');
    if (panels) observer.observe(panels, { subtree: true, attributes: true, attributeFilter: ['class'] });
}

async function pollHealth() {
    try {
        const res = await authFetch(`${API_BASE}/api/admin/health`);
        if (!res.ok) return;
        const h = await res.json();
        updateGauge('gaugeCPU', h.cpu_percent || 0);
        updateGauge('gaugeRAM', h.memory_percent || 0);
        updateGauge('gaugeDisk', h.disk_percent || 0);

        const lat = document.getElementById('healthLatency');
        if (lat) lat.textContent = `${h.api_latency_ms || '—'} ms`;

        // Info grid
        const info = document.getElementById('healthInfo');
        if (info) info.innerHTML = [
            ['Python', h.python_version || '—'],
            ['Platform', h.platform || '—'],
            ['Uptime', h.uptime_human || '—'],
            ['Memory', `${h.memory_used || '?'} / ${h.memory_total || '?'}`],
            ['Disk', `${h.disk_used || '?'} / ${h.disk_total || '?'}`],
            ['API Latency', `${h.api_latency_ms || '—'}ms`]
        ].map(([k, v]) => `<div class="health-info-item"><span class="health-label">${k}</span><span class="health-value">${v}</span></div>`).join('');
    } catch (e) { }
}

function updateHealth(sys) {
    updateGauge('gaugeCPU', sys.cpu_percent || 0);
    updateGauge('gaugeRAM', sys.memory_percent || 0);
    updateGauge('gaugeDisk', sys.disk_percent || 0);
}

function updateGauge(prefix, pct) {
    const fill = document.getElementById(`${prefix}Fill`);
    const val = document.getElementById(`${prefix}Val`);
    if (fill) {
        const circ = 2 * Math.PI * 54;
        fill.style.strokeDashoffset = circ - (circ * pct / 100);
    }
    if (val) val.textContent = `${Math.round(pct)}%`;
}

// ─── Analytics ───
let viewsChart = null;

function initAnalytics() {
    document.getElementById('btnResetAnalytics')?.addEventListener('click', async () => {
        if (!confirm('Reset all analytics data?')) return;
        try { await authFetch(`${API_BASE}/api/admin/analytics/reset`, { method: 'POST' }); toast('Analytics reset', 'success'); loadAnalyticsData(); } catch (e) { }
    });

    // Init chart
    const ctx = document.getElementById('viewsChart');
    if (ctx && window.Chart) {
        viewsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Views',
                    data: [],
                    borderColor: '#FBBF24',
                    backgroundColor: 'rgba(251,191,36,0.08)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#FBBF24',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94A3B8' } },
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94A3B8' } }
                }
            }
        });
    }

    loadAnalyticsData();
}

async function loadAnalyticsData() {
    try {
        const res = await authFetch(`${API_BASE}/api/admin/system`);
        if (!res.ok) return;
        const data = await res.json();

        // Update summary cards
        const totalViews = data.views || data.total_views || 0;
        const totalStreams = data.streams || data.stream_starts || 0;
        document.getElementById('analyticsTotalViews')?.textContent && (document.getElementById('analyticsTotalViews').textContent = totalViews);
        document.getElementById('analyticsTotalStreams')?.textContent && (document.getElementById('analyticsTotalStreams').textContent = totalStreams);

        // Update chart with whatever daily data is available
        if (data.daily_views && viewsChart) {
            viewsChart.data.labels = data.daily_views.map(d => d.date || d.day);
            viewsChart.data.datasets[0].data = data.daily_views.map(d => d.count || d.views);
            viewsChart.update();
        } else if (viewsChart) {
            // Generate last 7 days as fallback labels with current totals distributed
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const today = new Date().getDay();
            const labels = [];
            for (let i = 6; i >= 0; i--) {
                labels.push(days[(today - i + 7) % 7]);
            }
            viewsChart.data.labels = labels;
            // Show actual total in today's bar
            viewsChart.data.datasets[0].data = labels.map((_, i) => i === 6 ? totalViews : 0);
            viewsChart.update();
        }
    } catch (e) { }
}

// ─── Activity Feed (FIXED element ID) ───
let feedInterval = null;

function initActivityFeed() {
    loadActivityFeed();
    const observer = new MutationObserver(() => {
        const panel = document.getElementById('panel-feed');
        if (panel?.classList.contains('active') && !feedInterval) {
            feedInterval = setInterval(loadActivityFeed, 5000);
        } else if (!panel?.classList.contains('active') && feedInterval) {
            clearInterval(feedInterval);
            feedInterval = null;
        }
    });
    const panels = document.querySelector('.main-content');
    if (panels) observer.observe(panels, { subtree: true, attributes: true, attributeFilter: ['class'] });
}

async function loadActivityFeed() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/activity?limit=50`);
        const data = await res.json();
        const events = data.events || [];
        if (!events.length) {
            feed.innerHTML = '<div class="empty-box">No activity yet.</div>';
            return;
        }
        const icons = {
            stream: '📡', transfer: '📦', error: '❌', system: '⚙️',
            drive: '💾', bulk: '📋', scheduler: '⏰', download: '📥',
            complete: '✅', upload: '☁️'
        };
        feed.innerHTML = events.map(e => {
            const icon = icons[e.category] || e.icon || '📋';
            return `<div class="feed-item">
                <div class="feed-icon">${icon}</div>
                <div class="feed-text">
                    <strong>${e.text || ''}</strong>
                    <small>${e.ts || ''}</small>
                </div>
            </div>`;
        }).join('');
    } catch (e) { }
}
