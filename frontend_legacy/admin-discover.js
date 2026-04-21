/* ═══════════════════════════════════════════════════════════════════
   ATMOS V3.0 — Ultra Pro Max Discover Module
   Smart Search → Score → Group → Verify → Forward Pipeline
   ═══════════════════════════════════════════════════════════════════ */

let smartSearchData = null;    // Full response from /api/discover/search
let selectedDiscoverFiles = new Set(); // Set of "season:episode" keys
let currentPrefs = { quality: '1080p', language: '', seasons: [], sources: null };

function initDiscover() {
    const search = document.getElementById('smartSearch');
    let timer;
    search?.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(timer); runSmartSearch(); } });
    search?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSmartSearch, 600); });

    document.getElementById('btnSmartSearch')?.addEventListener('click', runSmartSearch);
    document.getElementById('btnAutoForward')?.addEventListener('click', autoForward);
    document.getElementById('btnForwardSelected')?.addEventListener('click', forwardSelected);
    document.getElementById('btnSelectAllSeasons')?.addEventListener('click', toggleAllSeasons);

    // Quality chip clicks
    document.getElementById('qualityChips')?.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        document.querySelectorAll('#qualityChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentPrefs.quality = chip.dataset.q;
    });

    // Source chip clicks
    document.getElementById('sourceChips')?.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const source = chip.dataset.s;
        
        if (!source) {
            // "All" clicked
            currentPrefs.sources = null;
        } else {
            if (!currentPrefs.sources) currentPrefs.sources = [];
            if (currentPrefs.sources.includes(source)) {
                currentPrefs.sources = currentPrefs.sources.filter(s => s !== source);
                if (currentPrefs.sources.length === 0) currentPrefs.sources = null;
            } else {
                currentPrefs.sources.push(source);
            }
        }
        
        // Re-render chips visually without re-fetching yet
        _updateSourceChipsVisuals();
    });

    // Source channels (legacy)
    document.getElementById('btnAddChannel')?.addEventListener('click', async () => {
        const input = document.getElementById('newChannelInput');
        const ch = input?.value?.trim();
        if (!ch) return;
        try {
            await authFetch(`${API_BASE}/api/admin/source-channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', channel: ch }) });
            input.value = '';
            loadSourceChannels();
            toast(`Added ${ch}`, 'success');
        } catch (e) { toast('Failed to add', 'error'); }
    });
}

// ═══════════════════════════════════════════════════════════════════
//  SMART SEARCH — calls /api/discover/search
// ═══════════════════════════════════════════════════════════════════

async function runSmartSearch() {
    const q = document.getElementById('smartSearch')?.value.trim();
    if (!q) return;

    const container = document.getElementById('smartResults');
    container.innerHTML = '<div class="discover-placeholder"><div class="loading-spinner"></div><p>Searching & analyzing...</p></div>';
    document.getElementById('prefBar').style.display = 'none';
    document.getElementById('tmdbCard').style.display = 'none';
    document.getElementById('completenessPanel').style.display = 'none';
    document.getElementById('smartResultsToolbar').style.display = 'none';

    try {
        const res = await authFetch(`${API_BASE}/api/discover/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: q,
                quality: currentPrefs.quality,
                language: currentPrefs.language,
                enabled_sources: currentPrefs.sources,
                limit: 100,
            })
        });
        const data = await res.json();
        if (data.error) { container.innerHTML = `<div class="discover-placeholder"><p>❌ ${data.error}</p></div>`; return; }

        smartSearchData = data;
        selectedDiscoverFiles.clear();

        renderTMDBCard(data.tmdb, data.media_type);
        renderPreferenceBar(data);
        renderCompleteness(data.completeness, data.media_type);
        renderSmartResults(data);
        document.getElementById('smartResultsToolbar').style.display = 'flex';
        refreshIcons();

    } catch (e) {
        container.innerHTML = `<div class="discover-placeholder"><p>Search failed: ${e.message}</p></div>`;
    }
}

// ═══════════════════════════════════════════════════════════════════
//  TMDB CARD
// ═══════════════════════════════════════════════════════════════════

function renderTMDBCard(tmdb, mediaType) {
    if (!tmdb || !tmdb.title) return;
    const card = document.getElementById('tmdbCard');
    card.style.display = 'flex';
    document.getElementById('tmdbPoster').src = tmdb.poster_url || '';
    document.getElementById('tmdbPoster').style.display = tmdb.poster_url ? 'block' : 'none';
    document.getElementById('tmdbTitle').textContent = tmdb.title;
    document.getElementById('tmdbYear').textContent = tmdb.year || '';
    document.getElementById('tmdbRating').textContent = tmdb.rating ? `⭐ ${Number(tmdb.rating).toFixed(1)}` : '';
    document.getElementById('tmdbType').textContent = mediaType === 'tv' ? '📺 TV Show' : '🎬 Movie';
    document.getElementById('tmdbSynopsis').textContent = (tmdb.synopsis || '').slice(0, 200);
}

// ═══════════════════════════════════════════════════════════════════
//  PREFERENCE BAR — Quality, Language, Season chips
// ═══════════════════════════════════════════════════════════════════

function renderPreferenceBar(data) {
    document.getElementById('prefBar').style.display = 'flex';

    // Dynamic quality chips from available data
    const availQ = data.available_qualities || [];
    if (availQ.length) {
        const qc = document.getElementById('qualityChips');
        qc.innerHTML = availQ.map(q => {
            const active = q === currentPrefs.quality ? ' active' : '';
            return `<button class="chip${active}" data-q="${q}">${q}</button>`;
        }).join('');
    }

    // Dynamic source chips
    const availS = data.available_providers || [];
    const sg = document.getElementById('sourceGroup');
    const sc = document.getElementById('sourceChips');
    if (availS.length > 0) {
        sg.style.display = 'block';
        // Add a global map for emoji lookup during render
        window._providerMap = window._providerMap || {};
        availS.forEach(p => window._providerMap[p.key] = p);
        
        sc.innerHTML = availS.map(s => `<button class="chip" data-s="${s.key}" title="${s.type}">${s.emoji} ${s.label}</button>`).join('');
        // Insert "All" at start
        sc.insertAdjacentHTML('afterbegin', `<button class="chip" data-s="">All</button>`);
        _updateSourceChipsVisuals();
    } else {
        sg.style.display = 'none';
    }

    // Language chips
    const langs = data.available_languages || [];
    const lg = document.getElementById('langGroup');
    const lc = document.getElementById('langChips');
    if (langs.length > 0) {
        lg.style.display = 'block';
        lc.innerHTML = `<button class="chip active" data-lang="">Any</button>` +
            langs.map(l => `<button class="chip" data-lang="${l}">${l}</button>`).join('');
        lc.addEventListener('click', e => {
            const chip = e.target.closest('.chip');
            if (!chip) return;
            lc.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentPrefs.language = chip.dataset.lang;
        });
    } else {
        lg.style.display = 'none';
    }

    // Season chips (for TV)
    const tmdb = data.tmdb || {};
    const seasons = tmdb.seasons || [];
    const seaG = document.getElementById('seasonGroup');
    const seaC = document.getElementById('seasonChips');
    if (seasons.length > 0) {
        seaG.style.display = 'block';
        seaC.innerHTML = seasons.map(s => {
            const num = s.season_number;
            const eps = s.episode_count;
            return `<button class="chip season-chip" data-s="${num}" title="${eps} episodes">S${num}</button>`;
        }).join('');
        seaC.addEventListener('click', e => {
            const chip = e.target.closest('.season-chip');
            if (!chip) return;
            chip.classList.toggle('active');
            updateSelectedSeasons();
        });
    } else {
        seaG.style.display = 'none';
    }
}

function toggleAllSeasons() {
    const chips = document.querySelectorAll('#seasonChips .season-chip');
    const allActive = [...chips].every(c => c.classList.contains('active'));
    chips.forEach(c => c.classList.toggle('active', !allActive));
    updateSelectedSeasons();
}

function updateSelectedSeasons() {
    const chips = document.querySelectorAll('#seasonChips .season-chip.active');
    currentPrefs.seasons = [...chips].map(c => parseInt(c.dataset.s));
}

// ═══════════════════════════════════════════════════════════════════
//  COMPLETENESS DASHBOARD
// ═══════════════════════════════════════════════════════════════════

function renderCompleteness(completeness, mediaType) {
    if (!completeness || mediaType !== 'tv' || !Object.keys(completeness).length) return;
    const panel = document.getElementById('completenessPanel');
    const grid = document.getElementById('completenessGrid');
    panel.style.display = 'block';

    grid.innerHTML = Object.entries(completeness).map(([sNum, info]) => {
        const pct = info.completeness_pct || 0;
        const barColor = pct === 100 ? '#22C55E' : pct >= 70 ? '#FBBF24' : '#EF4444';
        const qIcon = info.quality_consistent ? '✅' : '⚠️';
        const missing = info.missing_episodes?.length
            ? `<span class="comp-missing">Missing: Ep ${info.missing_episodes.slice(0, 5).join(', ')}${info.missing_episodes.length > 5 ? '...' : ''}</span>` : '';
        const mismatches = info.quality_mismatches?.length
            ? `<span class="comp-mismatch">${qIcon} ${info.quality_mismatches.length} quality mismatch(es)</span>` : '';

        return `<div class="comp-card glass">
            <div class="comp-header">
                <strong>Season ${sNum}</strong>
                <span class="comp-pct" style="color:${barColor}">${pct}%</span>
            </div>
            <div class="comp-bar-bg"><div class="comp-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
            <div class="comp-detail">
                <span>${info.total_found}/${info.total_expected} episodes</span>
                <span class="comp-quality">${info.dominant_quality || '?'}</span>
            </div>
            ${missing}${mismatches}
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════
//  RESULTS RENDERING — Grouped by Season → Episode
// ═══════════════════════════════════════════════════════════════════

function renderSmartResults(data) {
    const container = document.getElementById('smartResults');
    const groups = data.groups || {};
    const count = data.total_results || 0;
    document.getElementById('smartResultCount').textContent = `${count} results`;

    if (!count) {
        container.innerHTML = '<div class="discover-placeholder"><p>No results found.</p></div>';
        return;
    }

    // Movie results
    if (groups.movies) {
        container.innerHTML = groups.movies.map((r, i) => _renderResultCard(r, `m:${i}`)).join('');
        return;
    }

    // TV — render by season → episode
    let html = '';
    const sortedSeasons = Object.keys(groups).sort((a, b) => parseInt(a) - parseInt(b));

    for (const sNum of sortedSeasons) {
        const episodes = groups[sNum];
        const sortedEps = Object.keys(episodes).sort((a, b) => parseInt(a) - parseInt(b));

        html += `<div class="season-group">
            <div class="season-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>📺 Season ${sNum}</span>
                <span class="season-ep-count">${sortedEps.length} episodes</span>
                <i data-lucide="chevron-down" class="season-chevron"></i>
            </div>
            <div class="season-episodes">`;

        for (const eNum of sortedEps) {
            const ep = episodes[eNum];
            if (!ep || !ep.best) continue;
            const key = `${sNum}:${eNum}`;
            const sel = selectedDiscoverFiles.has(key) ? ' selected' : '';
            const best = ep.best;
            const altCount = ep.count > 1 ? `<span class="alt-count">+${ep.count - 1} alt</span>` : '';
            const qColor = _qualityColor(best.quality);
            const scoreBar = Math.min(best.score, 100);
            
            let sourceEmoji = '📱';
            if (best.source_provider && window._providerMap && window._providerMap[best.source_provider]) {
                sourceEmoji = window._providerMap[best.source_provider].emoji;
            }
            
            let magnetBtn = '';
            if (best.magnet) {
                magnetBtn = `<button class="magnet-btn" onclick="copyMagnet(event, '${best.magnet}')" title="Copy Magnet Link">🧲</button>`;
            }

            html += `<div class="ep-card${sel}" data-key="${key}" onclick="toggleFileSelect('${key}')">
                <div class="ep-check">${sel ? '✓' : ''}</div>
                <div class="ep-info">
                    <div class="ep-name">E${String(eNum).padStart(2, '0')} — <span class="ep-filename">${_escHtml(best.file_name)}</span></div>
                    <div class="ep-meta">
                        <span class="ep-size">${best.file_size_human || '—'}</span>
                        <span class="ep-channel" title="Provider: ${best.source_provider || 'telegram'}">${sourceEmoji} ${best.channel || best.source_provider || 'telegram'}</span>
                        ${magnetBtn}
                        ${altCount}
                    </div>
                </div>
                <div class="ep-badges">
                    <span class="quality-badge" style="${qColor}">${best.quality || '?'}</span>
                    ${best.languages?.length ? `<span class="lang-badge">${best.languages.join(', ')}</span>` : ''}
                    <span class="score-badge" title="Score: ${best.score}">
                        <div class="score-bar"><div class="score-fill" style="width:${scoreBar}%"></div></div>
                        ${best.score}
                    </span>
                </div>
            </div>`;
        }
        html += '</div></div>';
    }

    container.innerHTML = html;
    _updateSelectedCount();
    refreshIcons();
}

function toggleFileSelect(key) {
    if (selectedDiscoverFiles.has(key)) selectedDiscoverFiles.delete(key);
    else selectedDiscoverFiles.add(key);

    const card = document.querySelector(`.ep-card[data-key="${key}"]`);
    if (card) {
        card.classList.toggle('selected');
        card.querySelector('.ep-check').textContent = selectedDiscoverFiles.has(key) ? '✓' : '';
    }
    _updateSelectedCount();
}

function _updateSelectedCount() {
    document.getElementById('selectedCount').textContent = selectedDiscoverFiles.size;
}

function _qualityColor(q) {
    if (!q) return 'background:var(--bg-glass)';
    if (q.includes('2160') || q.includes('4k') || q.includes('4K')) return 'background:#FBBF24;color:#000';
    if (q.includes('1080')) return 'background:#22C55E;color:#000';
    if (q.includes('720')) return 'background:#3B82F6;color:#fff';
    return 'background:var(--bg-glass)';
}

function _renderResultCard(r, key) {
    const sel = selectedDiscoverFiles.has(key) ? ' selected' : '';
    const qColor = _qualityColor(r.quality);
    
    let sourceEmoji = '📱';
    if (r.source_provider && window._providerMap && window._providerMap[r.source_provider]) {
        sourceEmoji = window._providerMap[r.source_provider].emoji;
    }
    
    let magnetBtn = '';
    if (r.magnet) {
        magnetBtn = `<button class="magnet-btn" onclick="copyMagnet(event, '${r.magnet}')" title="Copy Magnet Link">🧲</button>`;
    }

    return `<div class="ep-card${sel}" data-key="${key}" onclick="toggleFileSelect('${key}')">
        <div class="ep-check">${sel ? '✓' : ''}</div>
        <div class="ep-info">
            <div class="ep-name">${_escHtml(r.file_name)}</div>
            <div class="ep-meta"><span class="ep-size">${r.file_size_human || '—'}</span><span class="ep-channel" title="Provider: ${r.source_provider || 'telegram'}">${sourceEmoji} ${r.channel || r.source_provider || 'telegram'}</span>${magnetBtn}</div>
        </div>
        <div class="ep-badges">
            <span class="quality-badge" style="${qColor}">${r.quality || '?'}</span>
            <span class="score-badge">${r.score}</span>
        </div>
    </div>`;
}

function copyMagnet(event, magnet) {
    event.stopPropagation();
    navigator.clipboard.writeText(magnet).then(() => {
        toast('Magnet link copied!', 'success');
    }).catch(err => {
        toast('Failed to copy magnet link', 'error');
    });
}

function _updateSourceChipsVisuals() {
    const sc = document.getElementById('sourceChips');
    if (!sc) return;
    const isAll = !currentPrefs.sources || currentPrefs.sources.length === 0;
    sc.querySelectorAll('.chip').forEach(c => {
        const s = c.dataset.s;
        if (!s) {
            c.classList.toggle('active', isAll);
        } else {
            c.classList.toggle('active', !isAll && currentPrefs.sources && currentPrefs.sources.includes(s));
        }
    });
}

function _escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ═══════════════════════════════════════════════════════════════════
//  FORWARD ACTIONS
// ═══════════════════════════════════════════════════════════════════

async function autoForward() {
    const q = document.getElementById('smartSearch')?.value.trim();
    if (!q) return;

    // Gather season selections
    updateSelectedSeasons();

    const btn = document.getElementById('btnAutoForward');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner-sm"></div> Processing...';

    try {
        const res = await authFetch(`${API_BASE}/api/discover/auto-forward`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: q,
                quality: currentPrefs.quality,
                language: currentPrefs.language,
                seasons: currentPrefs.seasons,
            })
        });
        const data = await res.json();
        if (data.success) {
            toast(`✅ Queued ${data.queued} files (${data.total_size_human})`, 'success');
            if (data.errors?.length) toast(`⚠️ ${data.errors.length} errors`, 'warning');
        } else {
            toast(data.message || 'No files matched', 'warning');
        }
    } catch (e) {
        toast('Auto-forward failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="zap"></i> Auto-Forward Best';
        refreshIcons();
    }
}

async function forwardSelected() {
    if (!selectedDiscoverFiles.size || !smartSearchData) return;

    // Build file list from selections
    const files = [];
    const groups = smartSearchData.groups || {};

    for (const key of selectedDiscoverFiles) {
        const [sOrM, idx] = key.split(':');
        if (sOrM === 'm') {
            // Movie
            const movie = groups.movies?.[parseInt(idx)];
            if (movie) files.push(movie);
        } else {
            // TV: season:episode
            const ep = groups[sOrM]?.[idx];
            if (ep?.best) files.push(ep.best);
        }
    }

    if (!files.length) { toast('No valid files selected', 'warning'); return; }

    const btn = document.getElementById('btnForwardSelected');
    btn.disabled = true;

    try {
        const res = await authFetch(`${API_BASE}/api/discover/forward`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files })
        });
        const data = await res.json();
        if (data.success) {
            toast(`✅ Queued ${data.queued} files`, 'success');
            selectedDiscoverFiles.clear();
            _updateSelectedCount();
        } else {
            toast(data.error || 'Forward failed', 'error');
        }
    } catch (e) {
        toast('Forward failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════════
//  SOURCE CHANNELS (Legacy)
// ═══════════════════════════════════════════════════════════════════

async function loadSourceChannels() {
    try {
        const res = await authFetch(`${API_BASE}/api/admin/source-channels`);
        if (!res.ok) return;
        const data = await res.json();
        renderChannelChips(data.channels || []);
    } catch (e) { }
}

function renderChannelChips(channels) {
    const c = document.getElementById('channelList');
    if (!c) return;
    c.innerHTML = channels.map(ch => `<div class="channel-chip"><span>${ch}</span><span class="channel-chip-remove" onclick="removeChannel('${ch}')"><i data-lucide="x"></i></span></div>`).join('');
    refreshIcons();
}

async function removeChannel(ch) {
    try {
        await authFetch(`${API_BASE}/api/admin/source-channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', channel: ch }) });
        loadSourceChannels();
        toast(`Removed ${ch}`, 'info');
    } catch (e) { }
}
