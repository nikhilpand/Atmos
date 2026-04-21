/* ═══════════════════════════════════════════════════════════════════
   ATMOS V2.0 — Overview Module
   Dashboard metrics, live transfers, status pills, GSAP counters
   ═══════════════════════════════════════════════════════════════════ */

async function loadOverview() {
    try {
        const [sysRes, vidRes] = await Promise.all([
            authFetch(`${API_BASE}/api/admin/system`).catch(() => null),
            authFetch(`${API_BASE}/api/videos`).catch(() => null)
        ]);

        if (sysRes?.ok) {
            const sys = await sysRes.json();

            // Metrics
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

            // Update transfer badge
            const badge = document.getElementById('navTransferBadge');
            const jobCount = (sys.active_jobs || []).length + (sys.queue_size || 0);
            if (badge) {
                badge.textContent = jobCount;
                badge.style.display = jobCount > 0 ? '' : 'none';
            }

            // Update health if available
            if (sys.cpu_percent !== undefined && typeof updateHealth === 'function') {
                updateHealth(sys);
            }
        }

        // Build recent uploads from video data
        if (vidRes?.ok) {
            const vidData = await vidRes.json();
            const videos = vidData.videos || [];
            renderRecentUploads(videos.slice(0, 6));
        }

        refreshIcons();
    } catch (e) {
        console.error('Overview load failed:', e);
    }
}

function animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;
    if (window.gsap) {
        gsap.to({ val: current }, {
            val: target, duration: 1, ease: 'power2.out',
            onUpdate: function () { el.textContent = Math.round(this.targets()[0].val); }
        });
    } else {
        el.textContent = target;
    }
}

function setStatus(id, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    const dot = el.querySelector('.pulse-dot');
    if (dot) dot.className = ok ? 'pulse-dot green' : 'pulse-dot';
}

function renderLiveTransfers(jobs) {
    const c = document.getElementById('liveTransfersContainer');
    if (!c) return;
    if (!jobs.length) {
        c.innerHTML = '<div class="empty-box">No active transfers.</div>';
        return;
    }
    c.innerHTML = jobs.map(j => {
        const speed = j.speed ? formatSpeed(j.speed) : '';
        return `<div class="transfer-card glass">
            <div class="transfer-card-icon"><i data-lucide="cloud-upload"></i></div>
            <div class="transfer-card-info">
                <div class="transfer-card-name">${j.filename || j.name || 'Unknown'}</div>
                <div class="transfer-card-meta">${j.status || ''} • ${j.progress || 0}%${speed ? ' • ' + speed : ''}</div>
                <div class="transfer-progress"><div class="transfer-progress-bar" style="width:${j.progress || 0}%"></div></div>
            </div>
        </div>`;
    }).join('');
    refreshIcons();
}

function renderRecentUploads(videos) {
    const c = document.getElementById('recentUploadsContainer');
    if (!c || !videos.length) return;
    c.innerHTML = videos.map(v => {
        const poster = v.poster_url || v.backdrop_url || v.thumbnail_url || '';
        const bg = poster ? `background-image:url('${poster}');background-size:cover;background-position:center;` : 'background:var(--bg-glass);';
        return `<div class="recent-card" style="${bg}">
            <div class="recent-card-overlay">
                <div class="recent-card-title">${v.title || v.name || ''}</div>
                <div class="recent-card-meta">${v.quality || ''} • ${v.size || ''}</div>
            </div>
        </div>`;
    }).join('');
}

function formatSpeed(bytesPerSec) {
    if (bytesPerSec > 1048576) return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
    if (bytesPerSec > 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
    return `${bytesPerSec} B/s`;
}
