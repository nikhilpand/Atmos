/* ═══════════════════════════════════════════════════════════════════
   ATMOS V2.0 — System Module
   Drive explorer, bulk ops, scheduler, telegram, config, appearance
   ═══════════════════════════════════════════════════════════════════ */

// ─── Drive Explorer ───
let driveBreadcrumb = [];

function initDriveExplorer() {
    document.getElementById('btnDriveRefresh')?.addEventListener('click', () => browseDrive());
    document.getElementById('btnDriveNewFolder')?.addEventListener('click', createDriveFolder);
    document.getElementById('btnDriveBack')?.addEventListener('click', () => {
        if (driveBreadcrumb.length > 0) {
            driveBreadcrumb.pop();
            const parentId = driveBreadcrumb.length ? driveBreadcrumb[driveBreadcrumb.length - 1].id : undefined;
            browseDrive(parentId);
        }
    });
    browseDrive();
}

async function browseDrive(folderId) {
    const list = document.getElementById('driveFileList');
    if (!list) return;
    list.innerHTML = '<div class="discover-placeholder"><div class="loading-spinner"></div><p>Loading...</p></div>';
    try {
        const url = folderId ? `${API_BASE}/api/admin/drive/browse?folder_id=${folderId}` : `${API_BASE}/api/admin/drive/browse`;
        const res = await authFetch(url);
        const data = await res.json();
        if (data.error) { list.innerHTML = `<div class="discover-placeholder"><p>${data.error}</p></div>`; return; }

        if (folderId && !driveBreadcrumb.find(b => b.id === folderId)) {
            // Find name from files or data
            const folderName = data.folder_name || folderId.slice(0, 12) + '…';
            driveBreadcrumb.push({ id: folderId, name: folderName });
        }
        renderBreadcrumb();

        const files = data.files || [];
        if (!files.length) { list.innerHTML = '<div class="discover-placeholder"><p>Empty folder</p></div>'; return; }

        // Sort: folders first, then files
        files.sort((a, b) => {
            if (a.is_folder && !b.is_folder) return -1;
            if (!a.is_folder && b.is_folder) return 1;
            return (a.name || '').localeCompare(b.name || '');
        });

        list.innerHTML = files.map(f => {
            const icon = f.is_folder ? 'folder' : getFileIcon(f.name);
            const click = f.is_folder ? `onclick="browseDrive('${f.id}')"` : '';
            const cls = f.is_folder ? 'drive-item folder' : 'drive-item';
            return `<div class="${cls}" ${click}>
                <div class="drive-item-icon"><i data-lucide="${icon}"></i></div>
                <div class="drive-item-name">${f.name}</div>
                <div class="drive-item-size">${f.size || ''}</div>
            </div>`;
        }).join('');
        refreshIcons();
    } catch (e) {
        list.innerHTML = `<div class="discover-placeholder"><p>Error: ${e.message}</p></div>`;
    }
}

function getFileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'].includes(ext)) return 'film';
    if (['mp3', 'flac', 'aac', 'wav'].includes(ext)) return 'music';
    if (['jpg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
    if (['srt', 'ass', 'vtt'].includes(ext)) return 'subtitles';
    return 'file';
}

function renderBreadcrumb() {
    const bc = document.getElementById('driveBreadcrumb');
    if (!bc) return;
    let html = `<span class="bc-item${!driveBreadcrumb.length ? ' active' : ''}" onclick="driveBreadcrumb=[];browseDrive()">📁 Root</span>`;
    driveBreadcrumb.forEach((b, i) => {
        const isLast = i === driveBreadcrumb.length - 1;
        html += ` <span style="color:var(--text-muted)">›</span> <span class="bc-item${isLast ? ' active' : ''}" onclick="driveBreadcrumb=driveBreadcrumb.slice(0,${i + 1});browseDrive('${b.id}')">${b.name}</span>`;
    });
    bc.innerHTML = html;
}

async function createDriveFolder() {
    const name = prompt('New folder name:');
    if (!name) return;
    const parentId = driveBreadcrumb.length ? driveBreadcrumb[driveBreadcrumb.length - 1].id : '';
    try {
        const body = { name };
        if (parentId) body.parent_id = parentId;
        const res = await authFetch(`${API_BASE}/api/admin/drive/mkdir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { toast('Folder created!', 'success'); browseDrive(parentId || undefined); }
        else { const d = await res.json(); toast(d.error || 'Failed', 'error'); }
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// ─── Bulk Operations ───
function initBulkOps() {
    document.getElementById('btnBulkPreview')?.addEventListener('click', previewBulkRename);
    document.getElementById('btnBulkApply')?.addEventListener('click', applyBulkRename);
    document.getElementById('btnBulkDelete')?.addEventListener('click', applyBulkDelete);
}

function previewBulkRename() {
    const find = document.getElementById('bulkFind')?.value;
    const replace = document.getElementById('bulkReplace')?.value ?? '';
    const useRegex = document.getElementById('bulkRegex')?.checked;
    if (!find) { toast('Enter a find pattern', 'warning'); return; }
    const preview = document.getElementById('bulkPreview');
    if (!preview) return;
    let lines = [];
    allLibFiles.forEach(f => {
        const name = f.name || '';
        let newName;
        try { newName = useRegex ? name.replace(new RegExp(find, 'gi'), replace) : name.split(find).join(replace); }
        catch (e) { newName = name; }
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
        try { newName = useRegex ? name.replace(new RegExp(find, 'gi'), replace) : name.split(find).join(replace); } catch (e) { return; }
        if (newName !== name) renames.push({ id: f.id, new_name: newName });
    });
    if (!renames.length) { toast('No files to rename', 'info'); return; }
    if (!confirm(`Rename ${renames.length} files?`)) return;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/bulk/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ renames }) });
        const d = await res.json();
        toast(`Renamed ${d.success} files${d.errors?.length ? `, ${d.errors.length} errors` : ''}`, d.errors?.length ? 'warning' : 'success');
        loadLibrary();
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function applyBulkDelete() {
    if (!selectedFiles.size) { toast('Select files in Library first', 'warning'); return; }
    if (!confirm(`Delete ${selectedFiles.size} selected files permanently?`)) return;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/bulk/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_ids: [...selectedFiles] }) });
        const d = await res.json();
        toast(`Deleted ${d.success} files`, 'success');
        selectedFiles.clear();
        loadLibrary();
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// ─── Scheduler ───
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
        const res = await authFetch(`${API_BASE}/api/admin/schedules`);
        const data = await res.json();
        const schedules = data.schedules || [];
        if (!schedules.length) { list.innerHTML = '<div class="empty-box">No schedules configured.</div>'; return; }
        list.innerHTML = schedules.map(s => {
            const intervalH = Math.round(s.interval / 3600);
            return `<div class="schedule-item glass">
                <div class="schedule-item-info">
                    <div class="schedule-item-title">${s.query || 'Untitled'} → ${s.channel || '—'}</div>
                    <div class="schedule-item-meta">
                        Every ${intervalH}h • Quality: ${s.quality || 'all'} •
                        ${s.enabled ? '<span style="color:var(--accent-green)">✅ Active</span>' : '<span style="color:var(--text-muted)">⏸ Paused</span>'}
                        • Last: ${s.last_run || 'Never'}
                    </div>
                </div>
                <button class="tool-btn-sm danger" onclick="deleteSchedule('${s.id}')"><i data-lucide="trash-2"></i></button>
            </div>`;
        }).join('');
        refreshIcons();
    } catch (e) { list.innerHTML = '<div class="empty-box">Failed to load schedules.</div>'; }
}

async function saveSchedule() {
    const channel = document.getElementById('schedChannel')?.value.trim();
    const query = document.getElementById('schedQuery')?.value.trim();
    const interval = parseInt(document.getElementById('schedInterval')?.value || '86400');
    const quality = document.getElementById('schedQuality')?.value || 'all';
    if (!channel || !query) { toast('Channel and query required', 'warning'); return; }
    try {
        const res = await authFetch(`${API_BASE}/api/admin/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, query, interval, quality }) });
        if (res.ok) { toast('Schedule created!', 'success'); loadSchedules(); document.getElementById('scheduleForm').style.display = 'none'; }
        else toast('Failed to save', 'error');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    try {
        await authFetch(`${API_BASE}/api/admin/schedules/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
        toast('Schedule deleted', 'info');
        loadSchedules();
    } catch (e) { }
}

// ─── Telegram Composer ───
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
            const res = await authFetch(`${API_BASE}/api/admin/telegram/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
            if (res.ok) { toast('Message sent!', 'success'); textarea.value = ''; }
            else toast('Send failed', 'error');
        } catch (e) { toast('Error: ' + e.message, 'error'); }
    });
}

async function loadBotInfo() {
    try {
        const res = await authFetch(`${API_BASE}/api/admin/bot-info`);
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById('tgBotName').textContent = data.bot_name || 'ATMOS Bot';
        document.getElementById('tgBotStatus').textContent = data.bot_running ? '✅ Running' : '❌ Offline';
        document.getElementById('tgAllowedUser').textContent = data.allowed_user || '—';
        document.getElementById('tgQueueSize').textContent = `${data.queue_size || 0} items`;
        document.getElementById('tgWorkerStatus').textContent = data.worker_status || '—';
    } catch (e) { }
}

// ─── Config ───
async function loadConfig() {
    try {
        const res = await authFetch(`${API_BASE}/api/admin/config`);
        if (!res.ok) return;
        const data = await res.json();
        const body = document.getElementById('configTableBody');
        const secrets = data.config || data;
        body.innerHTML = Object.entries(secrets).map(([k, v]) =>
            `<tr><td><code>${k}</code></td><td>${v ? '<span style="color:var(--accent-green)">✅ Set</span>' : '<span style="color:var(--accent-red)">❌ Missing</span>'}</td></tr>`
        ).join('');
    } catch (e) { }
}

// System actions
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnClearQueue')?.addEventListener('click', async () => {
        if (!confirm('Clear all pending transfers?')) return;
        try { await authFetch(`${API_BASE}/api/admin/clear_queue`, { method: 'POST' }); toast('Queue cleared', 'success'); } catch (e) { }
    });
    document.getElementById('btnRestartServer')?.addEventListener('click', async () => {
        if (!confirm('Restart the backend server?')) return;
        try { await authFetch(`${API_BASE}/api/admin/restart`, { method: 'POST' }); toast('Restarting...', 'warning'); } catch (e) { }
    });
    document.getElementById('btnShareAllConfig')?.addEventListener('click', shareAll);
    document.getElementById('btnReorgDrive')?.addEventListener('click', async () => {
        if (!confirm('Reorganize Drive files into folders?')) return;
        try { await authFetch(`${API_BASE}/api/admin/reorganize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); toast('Reorganizing...', 'info'); } catch (e) { }
    });
});

// ─── Appearance ───
function initAppearance() {
    const themes = {
        obsidian: { bg: '#050814', accent: '#FBBF24' },
        midnight: { bg: '#0a1628', accent: '#3B82F6' },
        neon: { bg: '#0B0F1A', accent: '#FF2D95' },
        emerald: { bg: '#052e16', accent: '#22C55E' }
    };

    document.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const t = themes[card.dataset.theme];
            if (t) {
                document.documentElement.style.setProperty('--bg-deep', t.bg);
                document.documentElement.style.setProperty('--accent', t.accent);
            }
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
