/* ═══════════════════════════════════════════════════════════════════
   ATMOS V2.0 — Library Module
   File listing (list/grid), TMDB posters, search, rename, delete,
   auto-rename, undo-rename, bulk select
   ═══════════════════════════════════════════════════════════════════ */

let libraryView = 'grid'; // Default to grid for poster view

async function loadLibrary() {
    try {
        const res = await authFetch(`${API_BASE}/api/videos`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        allLibFiles = data.videos || data.files || [];
        document.getElementById('fileCount').textContent = allLibFiles.length;
        renderLibraryView();
    } catch (e) {
        console.error('Library failed:', e);
    }
}

function renderLibraryView() {
    if (libraryView === 'grid') {
        renderLibraryGrid(allLibFiles);
    } else {
        renderLibraryTable(allLibFiles);
    }
}

function renderLibraryTable(files) {
    const table = document.querySelector('.table-wrapper');
    const grid = document.getElementById('libraryGridView');
    if (table) table.style.display = '';
    if (grid) grid.style.display = 'none';

    const body = document.getElementById('fileTableBody');
    if (!body) return;
    if (!files.length) {
        body.innerHTML = '<tr><td colspan="6" class="loading-cell">No files found.</td></tr>';
        return;
    }
    body.innerHTML = files.map((f, i) => {
        const ext = (f.name || '').split('.').pop().toUpperCase();
        const poster = f.poster_url || '';
        const posterThumb = poster ? `<img src="${poster}" class="lib-thumb" onerror="this.style.display='none'" />` : '';
        return `<tr data-id="${f.id}">
            <td>${i + 1}</td>
            <td class="lib-name-cell">${posterThumb}<span title="${f.name}">${f.title || f.name}</span></td>
            <td><span class="quality-badge">${ext}</span></td>
            <td>${f.size || '—'}</td>
            <td>${f.modified || '—'}</td>
            <td>
                <button class="tool-btn-sm" onclick="renameFile('${f.id}','${(f.name || '').replace(/'/g, "\\'")}')" title="Rename"><i data-lucide="edit-3"></i></button>
                <button class="tool-btn-sm" onclick="deleteFile('${f.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>`;
    }).join('');
    refreshIcons();
}

function renderLibraryGrid(files) {
    const table = document.querySelector('.table-wrapper');
    const grid = document.getElementById('libraryGridView');
    if (table) table.style.display = 'none';
    if (!grid) return;
    grid.style.display = 'grid';

    if (!files.length) {
        grid.innerHTML = '<div class="empty-box">No files.</div>';
        return;
    }

    grid.innerHTML = files.map(f => {
        const sel = selectedFiles.has(f.id) ? ' selected' : '';
        const poster = f.poster_url || f.backdrop_url || f.thumbnail_url || '';
        const bg = poster
            ? `background-image:url('${poster}');background-size:cover;background-position:center;`
            : 'background:linear-gradient(135deg, var(--bg-secondary), var(--surface));';
        const quality = f.quality || '';
        const rating = f.rating ? `⭐ ${parseFloat(f.rating).toFixed(1)}` : '';
        const year = f.year || '';
        const selectMode = document.body.classList.contains('select-mode');

        return `<div class="lib-card${sel}" style="${bg}" onclick="${selectMode ? `toggleFileSelect('${f.id}')` : ''}">
            ${quality ? `<span class="lib-card-quality">${quality}</span>` : ''}
            ${sel ? '<span class="lib-card-check">✓</span>' : ''}
            <div class="lib-card-overlay">
                <div class="lib-card-title">${f.title || f.name || ''}</div>
                <div class="lib-card-meta">
                    ${year ? `<span>${year}</span>` : ''}
                    ${rating ? `<span>${rating}</span>` : ''}
                    <span>${f.size || ''}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function toggleFileSelect(id) {
    if (!document.body.classList.contains('select-mode')) return;
    if (selectedFiles.has(id)) selectedFiles.delete(id);
    else selectedFiles.add(id);
    renderLibraryView();
    const counter = document.getElementById('fileCount');
    if (counter && selectedFiles.size) counter.textContent = `${selectedFiles.size} selected / ${allLibFiles.length}`;
    else if (counter) counter.textContent = allLibFiles.length;
    // Update bulk delete button
    const delBtn = document.getElementById('btnBulkDelete');
    if (delBtn) delBtn.innerHTML = `<i data-lucide="trash-2"></i> Delete Selected (${selectedFiles.size})`;
    refreshIcons();
}

// ─── Library Search ───
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('librarySearch')?.addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        const filtered = q ? allLibFiles.filter(f => (f.title || f.name || '').toLowerCase().includes(q)) : allLibFiles;
        document.getElementById('fileCount').textContent = filtered.length;
        if (libraryView === 'grid') renderLibraryGrid(filtered);
        else renderLibraryTable(filtered);
    });

    // View toggle
    document.querySelectorAll('.vt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            libraryView = btn.dataset.view || 'list';
            renderLibraryView();
        });
    });

    // Set grid view as default active
    document.getElementById('viewGrid')?.classList.add('active');
    document.getElementById('viewList')?.classList.remove('active');

    // Bulk select toggle
    document.getElementById('btnBulkSelect')?.addEventListener('click', () => {
        document.body.classList.toggle('select-mode');
        const active = document.body.classList.contains('select-mode');
        toast(active ? 'Select mode ON — click cards to select' : 'Select mode OFF', 'info');
        if (!active) selectedFiles.clear();
        renderLibraryView();
    });

    // Toolbar buttons
    document.getElementById('btnAutoRename')?.addEventListener('click', autoRenameAll);
    document.getElementById('btnUndoRename')?.addEventListener('click', undoRenameAll);
    document.getElementById('btnRefreshLib')?.addEventListener('click', () => { loadLibrary(); toast('Library refreshed', 'info'); });
    document.getElementById('btnShareAll')?.addEventListener('click', shareAll);
});

// ─── Auto Rename ───
async function autoRenameAll() {
    if (!confirm('Auto-rename all messy filenames using TMDB? This may take a while.')) return;
    const btn = document.getElementById('btnAutoRename');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Processing...';
    btn.disabled = true;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/auto-rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) throw new Error('Auto-rename failed');
        const data = await res.json();
        toast(`Auto-rename: ${data.renamed} renamed, ${data.skipped} skipped`, 'success');
        if (data.renamed > 0) loadLibrary();
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        refreshIcons();
    }
}

// ─── Undo Rename ───
async function undoRenameAll() {
    if (!confirm('Restore all files to original uploaded filenames?')) return;
    const btn = document.getElementById('btnUndoRename');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Reverting...';
    btn.disabled = true;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/undo-rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) throw new Error('Undo rename failed');
        const data = await res.json();
        toast(`Undo: ${data.restored} restored, ${data.skipped} skipped`, 'success');
        if (data.restored > 0) loadLibrary();
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        refreshIcons();
    }
}

// ─── Single File Operations ───
async function renameFile(id, oldName) {
    const newName = prompt('New filename:', oldName);
    if (!newName || newName === oldName) return;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/rename/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_name: newName }) });
        if (res.ok) { toast('Renamed!', 'success'); loadLibrary(); }
        else toast('Rename failed', 'error');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteFile(id) {
    if (!confirm('Delete this file permanently?')) return;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/delete/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        if (res.ok) { toast('Deleted', 'success'); loadLibrary(); }
        else toast('Delete failed', 'error');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function shareAll() {
    if (!confirm('Make ALL Drive files publicly accessible?')) return;
    try {
        const res = await authFetch(`${API_BASE}/api/admin/share-all`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        if (res.ok) toast('All files shared!', 'success');
        else toast('Share failed', 'error');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}
