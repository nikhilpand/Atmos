/* ═══════════════════════════════════════════════════════════════════
   ATMOS V2.0 — Transfers Module
   Active queue, transfer history, failed jobs, retry
   ═══════════════════════════════════════════════════════════════════ */

// Transfers are rendered from the overview data and history endpoint.
// This module handles the dedicated Transfers panel content.

async function loadTransfers() {
    try {
        const [sysRes, histRes] = await Promise.all([
            authFetch(`${API_BASE}/api/admin/system`).catch(() => null),
            authFetch(`${API_BASE}/api/admin/history`).catch(() => null)
        ]);

        // Active queue
        if (sysRes?.ok) {
            const sys = await sysRes.json();
            const jobs = sys.active_jobs || [];
            const activeContainer = document.getElementById('activeQueueContainer');
            const activeCount = document.getElementById('activeQueueCount');
            if (activeCount) activeCount.textContent = jobs.length;
            if (activeContainer) {
                if (!jobs.length) {
                    activeContainer.innerHTML = '<div class="empty-box">No active jobs.</div>';
                } else {
                    activeContainer.innerHTML = jobs.map(j => {
                        const speed = j.speed ? formatSpeed(j.speed) : '';
                        const statusClass = j.status === 'downloading' ? 'downloading' : j.status === 'uploading' ? 'uploading' : '';
                        return `<div class="transfer-card glass ${statusClass}">
                            <div class="transfer-card-icon"><i data-lucide="${j.status === 'uploading' ? 'cloud-upload' : 'download'}"></i></div>
                            <div class="transfer-card-info">
                                <div class="transfer-card-name">${j.filename || j.name || 'Unknown'}</div>
                                <div class="transfer-card-meta">
                                    <span class="transfer-status-badge ${j.status}">${j.phase || j.status || ''}</span>
                                    ${speed ? `<span>${speed}</span>` : ''}
                                    <span>${j.progress || 0}%</span>
                                </div>
                                <div class="transfer-progress"><div class="transfer-progress-bar" style="width:${j.progress || 0}%"></div></div>
                            </div>
                        </div>`;
                    }).join('');
                }
            }
        }

        // History
        if (histRes?.ok) {
            const histData = await histRes.json();
            const history = histData.history || histData.transfers || [];
            const completed = history.filter(h => h.status === 'completed');
            const failed = history.filter(h => h.status === 'failed');

            // Completed
            const histContainer = document.getElementById('transferHistoryContainer');
            const histCount = document.getElementById('historyCount');
            if (histCount) histCount.textContent = completed.length;
            if (histContainer) {
                if (!completed.length) {
                    histContainer.innerHTML = '<div class="empty-box">No history.</div>';
                } else {
                    histContainer.innerHTML = completed.slice(0, 50).map(h => `<div class="history-item">
                        <div class="history-icon success"><i data-lucide="check-circle"></i></div>
                        <div class="history-info">
                            <div class="history-name">${h.filename || h.name || 'Unknown'}</div>
                            <div class="history-meta">${h.duration || ''} • ${h.completed_at || ''}</div>
                        </div>
                        <span class="history-size">${h.size_human || ''}</span>
                    </div>`).join('');
                }
            }

            // Failed
            const failedContainer = document.getElementById('failedTransfersContainer');
            const failedCount = document.getElementById('failedCount');
            if (failedCount) failedCount.textContent = failed.length;
            if (failedContainer) {
                if (!failed.length) {
                    failedContainer.innerHTML = '<div class="empty-box">No failures.</div>';
                } else {
                    failedContainer.innerHTML = failed.map(h => `<div class="history-item failed">
                        <div class="history-icon error"><i data-lucide="alert-triangle"></i></div>
                        <div class="history-info">
                            <div class="history-name">${h.filename || h.name || 'Unknown'}</div>
                            <div class="history-meta error-text">${h.error || 'Unknown error'}</div>
                        </div>
                        <button class="tool-btn-sm" onclick="retryTransfer('${h.id}')" title="Retry"><i data-lucide="rotate-cw"></i></button>
                    </div>`).join('');
                }
            }
        }

        refreshIcons();
    } catch (e) {
        console.error('Transfers load failed:', e);
    }
}

async function retryTransfer(jobId) {
    try {
        const res = await authFetch(`${API_BASE}/api/admin/queue/retry/${jobId}`, { method: 'POST' });
        if (res.ok) { toast('Retrying...', 'info'); loadTransfers(); }
        else toast('Retry failed', 'error');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// Auto-refresh transfers panel when active
let transfersInterval = null;
document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(() => {
        const panel = document.getElementById('panel-transfers');
        if (panel?.classList.contains('active') && !transfersInterval) {
            loadTransfers();
            transfersInterval = setInterval(loadTransfers, 5000);
        } else if (!panel?.classList.contains('active') && transfersInterval) {
            clearInterval(transfersInterval);
            transfersInterval = null;
        }
    });
    const panels = document.querySelector('.main-content');
    if (panels) observer.observe(panels, { subtree: true, attributes: true, attributeFilter: ['class'] });
});
