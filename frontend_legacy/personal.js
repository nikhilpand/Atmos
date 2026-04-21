/* ATMOS V3.0 — Cinematic Frontend Engine */
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:7860' : 'https://nikhil1776-gdrivefwd.hf.space';
let MEDIA_BASE = 'https://nikhil1776-atmos-media.hf.space';
const SUBS_BASE = 'https://nikhil1776-atmos-subs.hf.space';
const META_BASE = 'https://nikhil1776-atmos-meta.hf.space';
let allFiles = [], filteredFiles = [], currentFile = null, billboardInterval = null, billboardIdx = 0;

// ═══ SPLASH — Cinematic Lens Flare ═══
function initSplash() {
    if (sessionStorage.getItem('atmos_splash_seen')) { document.getElementById('splash-overlay').classList.add('hidden'); return; }
    const canvas = document.getElementById('splash-canvas');
    const ctx = canvas.getContext('2d');
    let w, h, particles = [], flareX = -200, flareOpacity = 0;

    function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
    resize(); window.addEventListener('resize', resize);

    // Particles
    for (let i = 0; i < 60; i++) {
        particles.push({ x: Math.random()*w, y: Math.random()*h, r: Math.random()*2+0.5, vx: (Math.random()-0.5)*0.3, vy: (Math.random()-0.5)*0.3, a: Math.random()*0.5+0.1 });
    }

    function drawParticles() {
        ctx.clearRect(0, 0, w, h);
        particles.forEach(p => {
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
            ctx.fillStyle = `rgba(251,191,36,${p.a})`; ctx.fill();
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        });
        // Lens flare
        if (flareOpacity > 0) {
            const grad = ctx.createRadialGradient(flareX, h/2, 0, flareX, h/2, 300);
            grad.addColorStop(0, `rgba(255,255,255,${flareOpacity*0.8})`);
            grad.addColorStop(0.2, `rgba(251,191,36,${flareOpacity*0.5})`);
            grad.addColorStop(0.5, `rgba(255,45,149,${flareOpacity*0.15})`);
            grad.addColorStop(1, 'transparent');
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';
            // Streak
            ctx.save(); ctx.globalAlpha = flareOpacity*0.6;
            const sg = ctx.createLinearGradient(flareX-300, 0, flareX+300, 0);
            sg.addColorStop(0, 'transparent'); sg.addColorStop(0.5, `rgba(251,191,36,0.8)`); sg.addColorStop(1, 'transparent');
            ctx.fillStyle = sg; ctx.fillRect(flareX-300, h/2-2, 600, 4); ctx.restore();
        }
        requestAnimationFrame(drawParticles);
    }
    drawParticles();

    // GSAP Timeline
    const tl = gsap.timeline({ onComplete: endSplash });
    const letters = document.querySelectorAll('.splash-letter');
    tl.to(letters, { opacity: 1, y: 0, scale: 1, duration: 0.6, stagger: 0.1, ease: 'back.out(1.7)' }, 0.5);
    // Flare sweeps across
    const flareData = { x: -200, opacity: 0 };
    tl.to(flareData, { x: w+200, duration: 1.5, ease: 'power2.inOut', onUpdate: () => { flareX = flareData.x; } }, 1.0);
    tl.to(flareData, { opacity: 1, duration: 0.3, ease: 'power2.in', onUpdate: () => { flareOpacity = flareData.opacity; } }, 1.0);
    tl.to(flareData, { opacity: 0, duration: 0.5, ease: 'power2.out', onUpdate: () => { flareOpacity = flareData.opacity; } }, 2.0);
    // CSS flare element
    tl.to('#splash-flare', { opacity: 1, width: '120%', duration: 0.8, ease: 'power3.out' }, 1.2);
    tl.to('#splash-flare', { opacity: 0, duration: 0.5 }, 2.2);
    // Tagline
    tl.to('#splash-tagline', { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 2.0);
    // Exit after pause
    tl.to({}, { duration: 0.8 }, 2.8);

    document.getElementById('splash-skip').onclick = () => { tl.kill(); endSplash(); };
    document.addEventListener('keydown', (e) => { if (document.getElementById('splash-overlay').style.display !== 'none') { tl.kill(); endSplash(); } }, { once: true });
}

function endSplash() {
    sessionStorage.setItem('atmos_splash_seen', '1');
    const overlay = document.getElementById('splash-overlay');
    overlay.classList.add('exit');
    setTimeout(() => overlay.classList.add('hidden'), 800);
}

// ═══ AMBIENT CANVAS ═══
function initAmbient() {
    const c = document.getElementById('ambient-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    let w, h, orbs = [];
    function resize() { w = c.width = window.innerWidth; h = c.height = window.innerHeight; }
    resize(); window.addEventListener('resize', resize);
    for (let i = 0; i < 25; i++) {
        orbs.push({ x: Math.random()*w, y: Math.random()*h, r: Math.random()*80+20, vx: (Math.random()-0.5)*0.2, vy: (Math.random()-0.5)*0.2, hue: Math.random()>0.5 ? 45 : 270, a: Math.random()*0.03+0.01 });
    }
    function draw() {
        ctx.clearRect(0,0,w,h);
        orbs.forEach(o => {
            const g = ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);
            g.addColorStop(0, `hsla(${o.hue},80%,60%,${o.a})`);
            g.addColorStop(1, 'transparent');
            ctx.fillStyle = g; ctx.fillRect(o.x-o.r,o.y-o.r,o.r*2,o.r*2);
            o.x += o.vx; o.y += o.vy;
            if(o.x<-o.r) o.x=w+o.r; if(o.x>w+o.r) o.x=-o.r;
            if(o.y<-o.r) o.y=h+o.r; if(o.y>h+o.r) o.y=-o.r;
        });
        requestAnimationFrame(draw);
    }
    draw();
}

// ═══ NAV ═══
function initNav() {
    const nav = document.getElementById('main-nav');
    window.addEventListener('scroll', () => { nav.classList.toggle('scrolled', window.scrollY > 50); });

    // Search toggle
    const toggle = document.getElementById('search-toggle');
    const input = document.getElementById('search-input');
    if (toggle && input) {
        toggle.addEventListener('click', () => {
            input.classList.toggle('search-expanded');
            if (input.classList.contains('search-expanded')) input.focus();
        });
    }

    // Hamburger
    const hamburger = document.getElementById('nav-hamburger');
    const overlay = document.getElementById('mobile-nav-overlay');
    if (hamburger && overlay) {
        hamburger.addEventListener('click', () => overlay.classList.toggle('open'));
        overlay.querySelectorAll('.mobile-nav-link').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault(); overlay.classList.remove('open');
                const section = a.dataset.section;
                if (section === 'home') filterByGenre('all');
                else if (section === 'movies') filterByGenre('movie');
                else if (section === 'shows') filterByGenre('show');
                else if (section === 'mylist') { filterByGenre('all'); renderMyList(); }
            });
        });
    }

    // Nav links
    document.querySelectorAll('.nav-links a').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-links a').forEach(n => n.classList.remove('active'));
            a.classList.add('active');
            const s = a.dataset.section;
            if (s === 'home') filterByGenre('all');
            else if (s === 'movies') filterByGenre('movie');
            else if (s === 'shows') filterByGenre('show');
            else if (s === 'mylist') { renderMyList(); }
        });
    });

    // Genre tabs
    document.querySelectorAll('.genre-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.genre-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterByGenre(btn.dataset.genre);
        });
    });

    // Search
    let searchTimer;
    if (input) {
        input.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                const q = input.value.trim().toLowerCase();
                const sr = document.getElementById('search-results-row');
                const ar = document.getElementById('all-content-row');
                if (!q) { sr.style.display='none'; ar.style.display=''; return; }
                const res = allFiles.filter(f => (f.clean_name||f.name).toLowerCase().includes(q));
                sr.style.display=''; ar.style.display='none';
                document.getElementById('search-heading').innerHTML = `<i data-lucide="search"></i> Results for "${input.value.trim()}"`;
                renderGrid(res, 'search-grid');
                if (window.lucide) lucide.createIcons();
            }, 300);
        });
    }

    // Admin shortcut
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'A') { e.preventDefault(); window.location.href = 'admin.html'; }
    });
}

// ═══ CONTENT LOADING ═══
let allCollections = []; // Grouped shows + individual movies

async function loadContent() {
    // Show skeleton cards immediately
    const grid = document.getElementById('content-grid');
    if (grid) {
        grid.innerHTML = Array(12).fill('').map(() =>
            `<div class="card skeleton-card" style="aspect-ratio:2/3;background:var(--bg-card);border-radius:var(--card-radius);overflow:hidden">
                <div style="width:100%;height:100%;background:linear-gradient(90deg,rgba(255,255,255,0.02) 25%,rgba(255,255,255,0.06) 50%,rgba(255,255,255,0.02) 75%);background-size:200% 100%;animation:shimmer 1.5s ease infinite"></div>
            </div>`
        ).join('');
    }
    try {
        const res = await fetch(`${API_BASE}/api/videos`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.media_base_url) MEDIA_BASE = data.media_base_url;
        allFiles = (data.videos || data.files || []).map(enrichFile);

        // Build collections: group TV episodes, deduplicate movies by quality
        allCollections = buildCollections(allFiles);
        filteredFiles = [...allCollections];

        document.getElementById('content-count').textContent = `${allCollections.length} titles`;
        renderGrid(allCollections);
        setupBillboard();
        renderContinueWatching();
        renderMyList();
        renderCollectionsRow();
        document.getElementById('empty-state').style.display = allFiles.length === 0 ? '' : 'none';
        if (window.lucide) lucide.createIcons();

        // Background: enrich metadata from meta space (non-blocking)
        _enrichMetadata(allFiles);
    } catch (err) {
        console.error('Load failed:', err);
        if (grid) grid.innerHTML = '';
        document.getElementById('empty-state').style.display = '';
    }
}

// Background metadata enrichment from TMDB via meta space
async function _enrichMetadata(files) {
    try {
        const needsEnrich = files.filter(f => !f.tmdb_enriched && f.clean_name).slice(0, 20);
        if (!needsEnrich.length) return;
        const titles = needsEnrich.map(f => ({ title: f.clean_name, year: f.year || null, media_type: f.media_type === 'show' ? 'tv' : 'movie' }));
        const res = await fetch(`${META_BASE}/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ titles }),
        }).catch(() => null);
        if (!res || !res.ok) return;
        const data = await res.json();
        const results = data.results || [];
        results.forEach((meta, i) => {
            if (meta && needsEnrich[i]) {
                const file = needsEnrich[i];
                file.poster_url = file.poster_url || meta.poster_url || '';
                file.backdrop_url = file.backdrop_url || meta.backdrop_url || '';
                file.overview = meta.overview || file.overview || '';
                file.rating = meta.rating || file.rating;
                file.genres = meta.genres || file.genres;
                file.tmdb_enriched = true;
            }
        });
    } catch (e) { /* metadata enrichment is optional */ }
}

function enrichFile(file) {
    const name = file.name || '';
    let quality = 'unknown';
    const qm = name.match(/(?:2160p|4K|1080p|720p|480p|360p)/i);
    if (qm) quality = qm[0].toLowerCase().replace('4k','2160p');
    let mediaType = 'movie';
    if (/S\d+E\d+/i.test(name)) mediaType = 'show';
    return { ...file, quality: file.quality || quality, media_type: file.type==='series'?'show':(file.type||file.media_type||mediaType), clean_name: file.title||file.clean_name||cleanFileName(name), poster_url: file.poster_url||file.backdrop_url||file.thumbnail_url||'', backdrop_url: file.backdrop_url||file.poster_url||file.thumbnail_url||'' };
}

function cleanFileName(n) { return n.replace(/\.[^.]+$/,'').replace(/[\._]/g,' ').replace(/\b(720p|1080p|2160p|4k|x264|x265|hevc|webrip|web-dl|bluray|amzn|10bit)\b/gi,'').replace(/\[.*?\]/g,'').replace(/@\S+/g,'').replace(/\s+/g,' ').trim(); }

// ═══ COLLECTION GROUPING ═══
const QUALITY_RANK = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1, '360p': 0, 'unknown': -1 };

function buildCollections(files) {
    const shows = {};   // group by show_title
    const movies = {};  // deduplicate by clean_name
    
    files.forEach(f => {
        if (f.media_type === 'show' || f.media_type === 'anime') {
            const key = (f.show_title || f.clean_name || '').toLowerCase().replace(/\s+s\d+e\d+.*/i, '').trim();
            if (!shows[key]) {
                shows[key] = {
                    ...f,
                    _isCollection: true,
                    _episodes: [],
                    _episodeCount: 0,
                    clean_name: f.show_title || f.clean_name.replace(/\s+S\d+E\d+.*/i, '').trim(),
                };
            }
            shows[key]._episodes.push(f);
            shows[key]._episodeCount = shows[key]._episodes.length;
            // Use best poster/backdrop
            if (f.poster_url && !shows[key].poster_url) shows[key].poster_url = f.poster_url;
            if (f.backdrop_url && !shows[key].backdrop_url) shows[key].backdrop_url = f.backdrop_url;
            if (f.rating > (shows[key].rating || 0)) shows[key].rating = f.rating;
            if (f.synopsis && !shows[key].synopsis) shows[key].synopsis = f.synopsis;
        } else {
            // Deduplicate movies: keep highest quality
            const key = (f.clean_name || '').toLowerCase().replace(/\s*\[.*?\]/g, '').trim();
            const rank = QUALITY_RANK[f.quality] ?? -1;
            if (!movies[key] || rank > (QUALITY_RANK[movies[key].quality] ?? -1)) {
                movies[key] = { ...f, _isCollection: false };
            }
        }
    });
    
    // Sort episodes within each show
    Object.values(shows).forEach(show => {
        show._episodes.sort((a, b) => {
            const sa = (a.season || 1) * 1000 + (a.episode || 1);
            const sb = (b.season || 1) * 1000 + (b.episode || 1);
            return sa - sb;
        });
    });
    
    return [...Object.values(shows), ...Object.values(movies)];
}

function renderCollectionsRow() {
    const showCollections = allCollections.filter(f => f._isCollection && f._episodeCount > 1);
    const row = document.getElementById('collections-row');
    const grid = document.getElementById('collections-grid');
    if (!row || !grid) return;
    row.style.display = showCollections.length ? '' : 'none';
    grid.innerHTML = showCollections.map(f => collectionCardHTML(f)).join('');
    grid.querySelectorAll('.card').forEach((card, i) => {
        card.addEventListener('click', () => openDetail(showCollections[i]));
        card.addEventListener('mousemove', (e) => {
            const r = card.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width - 0.5;
            const y = (e.clientY - r.top) / r.height - 0.5;
            card.style.transform = `perspective(800px) rotateY(${x*8}deg) rotateX(${-y*8}deg) translateY(-8px)`;
        });
        card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
    if (window.lucide) lucide.createIcons();
}

function collectionCardHTML(f) {
    const poster = f.poster_url || f.backdrop_url || '';
    const epCount = f._episodeCount || 0;
    return `<div class="card" data-id="${f.id}">
        <span class="card-quality" style="background:linear-gradient(135deg,#6366f1,#a855f7)">${epCount} EP</span>
        ${poster ? `<img class="card-poster" src="${poster}" alt="${f.clean_name}" loading="lazy" onerror="this.style.display='none'">` : `<div class="card-poster" style="background:var(--gradient-card);display:flex;align-items:center;justify-content:center;font-size:2rem">📺</div>`}
        <div class="card-overlay">
            <div class="card-overlay-play"><i data-lucide="tv"></i></div>
            <div class="card-overlay-title">${f.clean_name}</div>
            <div class="card-overlay-meta">${f.year||''} • ${epCount} Episodes</div>
        </div>
    </div>`;
}

function filterByGenre(genre) {
    const heading = document.getElementById('content-heading');
    const icons = { all:'clapperboard', movie:'film', show:'tv', anime:'sparkles', recent:'clock' };
    if (genre === 'all') { filteredFiles = [...allCollections]; heading.innerHTML = `<i data-lucide="${icons.all}"></i> All Content`; }
    else if (genre === 'recent') { filteredFiles = [...allFiles].slice(0,30); heading.innerHTML = `<i data-lucide="${icons.recent}"></i> Recently Added`; }
    else if (genre === 'movie') { filteredFiles = allCollections.filter(f => !f._isCollection); heading.innerHTML = `<i data-lucide="${icons.movie}"></i> Movies`; }
    else if (genre === 'show' || genre === 'anime') { filteredFiles = allCollections.filter(f => f._isCollection || f.media_type==='show'||f.media_type==='anime'); heading.innerHTML = `<i data-lucide="${icons.show}"></i> TV Shows`; }
    document.getElementById('content-count').textContent = `${filteredFiles.length} titles`;
    renderGrid(filteredFiles);
    if (window.lucide) lucide.createIcons();
}

// ═══ RENDER GRID ═══
function renderGrid(files, containerId = 'content-grid') {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    grid.innerHTML = files.map(f => cardHTML(f)).join('');
    grid.querySelectorAll('.card').forEach((card, i) => {
        card.style.animationDelay = `${i*40}ms`;
        card.addEventListener('click', () => openDetail(files[i]));
        // 3D tilt
        card.addEventListener('mousemove', (e) => {
            const r = card.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width - 0.5;
            const y = (e.clientY - r.top) / r.height - 0.5;
            card.style.transform = `perspective(800px) rotateY(${x*8}deg) rotateX(${-y*8}deg) translateY(-8px)`;
        });
        card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
    if (window.lucide) lucide.createIcons();
}

function cardHTML(f) {
    const poster = f.poster_url || f.backdrop_url || '';
    const q = f.quality !== 'unknown' ? `<span class="card-quality">${f.quality.toUpperCase()}</span>` : '';
    const progress = getProgress(f.id);
    const pbar = progress > 0 ? `<div class="card-progress"><div class="card-progress-bar" style="width:${progress}%"></div></div>` : '';
    return `<div class="card" data-id="${f.id}">
        ${q}
        ${poster ? `<img class="card-poster" src="${poster}" alt="${f.clean_name}" loading="lazy" onerror="this.style.display='none'">` : `<div class="card-poster" style="background:var(--gradient-card);display:flex;align-items:center;justify-content:center;font-size:2rem">🎬</div>`}
        <div class="card-overlay">
            <div class="card-overlay-play"><i data-lucide="play"></i></div>
            <div class="card-overlay-title">${f.clean_name}</div>
            <div class="card-overlay-meta">${f.year||''} ${f.quality!=='unknown'?'• '+f.quality.toUpperCase():''}</div>
        </div>
        ${pbar}
    </div>`;
}

// ═══ DETAIL MODAL ═══
function openDetail(file) {
    currentFile = file;
    const modal = document.getElementById('detail-modal');
    const hero = document.getElementById('detail-hero');
    const isCollection = file._isCollection && file._episodes;
    const playTarget = isCollection ? file._episodes[0] : file;
    const typeLabel = isCollection ? `TV Show • ${file._episodeCount} Episodes` : (file.media_type==='show'?'TV Show':'Movie');
    const qualityLabel = isCollection ? '' : `<span class="quality-badge">${(file.quality||'HD').toUpperCase()}</span><span class="meta-dot">•</span>`;
    
    hero.innerHTML = `<img src="${file.backdrop_url||file.poster_url||''}" alt="${file.clean_name}"><div class="detail-vignette"></div><div class="detail-info"><h2 class="detail-title">${file.clean_name}</h2><div class="detail-meta">${qualityLabel}<span>${file.year||''}</span><span class="meta-dot">•</span><span>${typeLabel}</span>${file.rating?`<span class="meta-dot">•</span><span class="rating-badge">★ ${file.rating}</span>`:''}</div><p class="detail-synopsis">${file.synopsis||'No synopsis available.'}</p><div class="detail-actions"><button class="btn-play" onclick="playFile(allFiles.find(f=>f.id==='${playTarget.id}')||currentFile)"><i data-lucide="play"></i> ${isCollection?'Play S'+((playTarget.season||1))+'E'+((playTarget.episode||1)):'Play'}</button><button class="btn-info" onclick="toggleMyList(currentFile.id)"><i data-lucide="${isInMyList(currentFile.id)?'check':'plus'}"></i> My List</button></div></div>`;
    
    // Episodes list
    const extra = document.getElementById('detail-extra');
    const eps = isCollection ? file._episodes : allFiles.filter(f => f.show_title && f.show_title === file.show_title);
    if (eps && eps.length > 1) {
        // Group by season
        const seasons = {};
        eps.forEach(ep => { const s = ep.season || 1; if (!seasons[s]) seasons[s] = []; seasons[s].push(ep); });
        let html = '';
        Object.keys(seasons).sort((a,b) => a-b).forEach(s => {
            html += `<h3 style="margin:16px 0 8px;font-size:14px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">Season ${s}</h3>`;
            seasons[s].sort((a,b) => (a.episode||1) - (b.episode||1)).forEach(ep => {
                const epProgress = getProgress(ep.id);
                const pbar = epProgress > 0 ? `<div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.1);border-radius:2px"><div style="height:100%;width:${epProgress}%;background:var(--accent-primary);border-radius:2px"></div></div>` : '';
                html += `<div style="position:relative;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-radius:10px;background:rgba(255,255,255,0.04);margin-bottom:6px;cursor:pointer;transition:background 0.2s;border:1px solid rgba(255,255,255,0.05)" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.04)'" onclick="playFile(allFiles.find(f=>f.id==='${ep.id}'))"><div style="display:flex;align-items:center;gap:12px"><span style="color:var(--accent-primary);font-weight:600;font-size:13px;min-width:32px">E${ep.episode||1}</span><span style="font-size:14px">${ep.clean_name}</span></div><span style="color:var(--text-muted);font-size:12px">${ep.size||''}</span>${pbar}</div>`;
            });
        });
        extra.innerHTML = html;
    } else extra.innerHTML = '';

    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('visible'));
    if (window.lucide) lucide.createIcons();
}

function closeDetail() {
    const m = document.getElementById('detail-modal');
    m.classList.remove('visible');
    setTimeout(() => { m.style.display = 'none'; }, 300);
}
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('detail-close')?.addEventListener('click', closeDetail);
    document.getElementById('detail-modal')?.addEventListener('click', (e) => { if (e.target.id === 'detail-modal') closeDetail(); });
});

// ═══ BILLBOARD ═══
function setupBillboard() {
    const candidates = allFiles.filter(f => f.backdrop_url || f.poster_url).slice(0, 8);
    if (!candidates.length) return;
    const slides = document.getElementById('billboard-slides');
    slides.innerHTML = candidates.map((f, i) => `<div class="billboard-slide${i===0?' active':''}" style="background-image:url('${f.backdrop_url||f.poster_url}');background-size:cover;background-position:center"></div>`).join('');
    const dots = document.getElementById('billboard-dots');
    dots.innerHTML = candidates.map((_, i) => `<span class="dot${i===0?' active':''}" data-i="${i}"></span>`).join('');
    dots.querySelectorAll('.dot').forEach(d => d.addEventListener('click', () => { billboardIdx = +d.dataset.i; showBillboard(candidates); }));
    showBillboard(candidates);
    billboardInterval = setInterval(() => { billboardIdx = (billboardIdx + 1) % candidates.length; showBillboard(candidates); }, 6000);
}

function showBillboard(items) {
    const f = items[billboardIdx];
    document.querySelectorAll('.billboard-slide').forEach((s,i) => s.classList.toggle('active', i===billboardIdx));
    document.querySelectorAll('.billboard-dots .dot').forEach((d,i) => d.classList.toggle('active', i===billboardIdx));
    document.getElementById('billboard-title').textContent = f.clean_name;
    document.getElementById('billboard-year').textContent = f.year || '';
    document.getElementById('billboard-type').textContent = f.media_type==='show'?'TV Show':'Movie';
    document.getElementById('billboard-synopsis').textContent = f.synopsis || '';
    const q = document.getElementById('billboard-quality');
    if (q) { q.textContent = (f.quality||'HD').toUpperCase(); }
    const r = document.getElementById('billboard-rating');
    if (r && f.rating) r.textContent = `★ ${f.rating}`;
    document.getElementById('billboard-play').onclick = () => playFile(f);
    document.getElementById('billboard-info').onclick = () => openDetail(f);
    const addBtn = document.getElementById('billboard-addlist');
    if (addBtn) addBtn.onclick = () => toggleMyList(f.id);
}

// ═══ PLAYER ═══
let _playerRetries = 0;
const MAX_RETRIES = 3;

function playFile(file) {
    if (!file) return;
    closeDetail();
    currentFile = file;
    _playerRetries = 0;
    const overlay = document.getElementById('player-overlay');
    const container = document.getElementById('player-container');

    // Show overlay immediately with loading state
    overlay.classList.add('active');
    overlay.style.display = 'block';

    // Show loading spinner
    _showPlayerLoading(container, file);

    // Clean up old player + audio selector
    container.querySelector('media-player')?.remove();
    container.querySelector('.audio-track-selector')?.remove();

    // Route: MKV → HLS adaptive stream, MP4 → direct/API stream
    const isMkv = (file.name || '').toLowerCase().endsWith('.mkv') ||
                  (file.mime || '').includes('matroska') ||
                  file.mime === 'application/octet-stream';
    const url = isMkv
        ? `${MEDIA_BASE}/stream/${file.id}`
        : (file.stream_url ? `${API_BASE}${file.stream_url}` : `${API_BASE}/api/stream/${file.id}`);

    const player = document.createElement('media-player');
    player.setAttribute('src', url);
    player.setAttribute('title', file.clean_name || file.name);
    player.setAttribute('autoplay', '');
    player.setAttribute('crossorigin', '');
    player.setAttribute('playsinline', '');
    player.setAttribute('key-disabled', 'false');
    player.style.opacity = '0';
    player.style.transition = 'opacity 0.4s ease';
    player.innerHTML = '<media-provider></media-provider><media-video-layout></media-video-layout>';
    container.appendChild(player);

    // Wait for can-play BEFORE showing video (fixes black screen)
    player.addEventListener('can-play', () => {
        player.style.opacity = '1';
        _hidePlayerLoading(container);
        // Resume from saved position
        const saved = getProgress(file.id, true);
        if (saved > 0) player.currentTime = saved;
        // Show quality badge
        _showQualityBadge(player, container);
    }, { once: true });

    // Save progress periodically
    player.addEventListener('time-update', (e) => {
        if (e.detail && file.id) saveProgress(file.id, e.detail.currentTime, e.detail.duration);
    });

    // Next episode auto-play on video end
    player.addEventListener('ended', () => {
        const next = _findNextEpisode(file);
        if (next) {
            _showNextEpisode(next);
        } else {
            toast('✅ Playback finished', 'info');
        }
    });

    // Error handling with retry
    player.addEventListener('error', (e) => {
        console.error('Player error:', e);
        if (_playerRetries < MAX_RETRIES) {
            _playerRetries++;
            toast(`⚠️ Playback error — retrying (${_playerRetries}/${MAX_RETRIES})...`, 'warning');
            setTimeout(() => {
                player.setAttribute('src', url);
            }, 1500 * _playerRetries);
        } else {
            _hidePlayerLoading(container);
            _showPlayerError(container, file);
        }
    });

    // Intercept seeking for remuxed streams to restart stream with new start time
    player.addEventListener('seek-request', (e) => {
        if (!isMkv) return;
        e.preventDefault(); // Stop native seeking

        const requestTime = e.detail;
        _showPlayerLoading(container, file);
        player.style.opacity = '0';

        const currentSrc = player.getAttribute('src');
        const urlObj = new URL(currentSrc, window.location.href);
        urlObj.searchParams.set('start', requestTime);
        
        // Changing src will trigger a reload, re-firing can-play
        player.setAttribute('src', urlObj.toString());
        
        // Re-attach can-play for this reload
        player.addEventListener('can-play', () => {
            player.style.opacity = '1';
            _hidePlayerLoading(container);
            player.currentTime = requestTime; // visually update seekbar
        }, { once: true });
    });

    // Fetch audio/subtitle tracks and build UI
    loadTracks(file, player, container);
}

function _showPlayerLoading(container, file) {
    let loader = container.querySelector('.player-loader');
    if (loader) loader.remove();
    loader = document.createElement('div');
    loader.className = 'player-loader';
    loader.innerHTML = `
        <div class="player-loader-inner">
            <div class="player-loader-spinner"></div>
            <div class="player-loader-title">${file.clean_name || file.name}</div>
            <div class="player-loader-sub">Preparing stream...</div>
        </div>`;
    container.appendChild(loader);
}

function _hidePlayerLoading(container) {
    const loader = container.querySelector('.player-loader');
    if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 300); }
}

function _showPlayerError(container, file) {
    let err = container.querySelector('.player-error');
    if (err) err.remove();
    err = document.createElement('div');
    err.className = 'player-error';
    err.innerHTML = `
        <div class="player-error-inner">
            <div style="font-size:48px;margin-bottom:16px">⚠️</div>
            <div style="font-size:18px;font-weight:600;margin-bottom:8px">Playback Failed</div>
            <div style="color:var(--text-muted);margin-bottom:20px;font-size:14px">${file.clean_name || file.name}</div>
            <button onclick="_retryPlayback()" style="padding:10px 28px;background:var(--accent-primary);border:none;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;font-weight:600">Retry</button>
            <button onclick="closePlayer()" style="padding:10px 28px;background:rgba(255,255,255,0.1);border:none;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;margin-left:8px">Close</button>
        </div>`;
    container.appendChild(err);
}

function _retryPlayback() {
    if (currentFile) { _playerRetries = 0; playFile(currentFile); }
}

async function loadTracks(file, player, container) {
    try {
        const res = await fetch(`${MEDIA_BASE}/tracks/${file.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const provider = player.querySelector('media-provider');
        if (!provider) return;

        const audioTracks = data.audio_tracks || [];
        const subtitleTracks = data.subtitle_tracks || [];
        const isMkv = data.needs_remux;

        // ── Subtitle Tracks ──
        subtitleTracks.forEach((sub, i) => {
            const track = document.createElement('track');
            track.src = `${MEDIA_BASE}/subtitle/${file.id}/${sub.index}`;
            track.kind = 'subtitles';
            track.label = sub.label || `Subtitle ${i + 1}`;
            track.srclang = sub.lang_code || 'un';
            if (sub.language === 'eng' || sub.lang_code === 'en') track.default = true;
            provider.appendChild(track);
        });

        const hasEnglishSub = subtitleTracks.some(s => s.language === 'eng' || s.lang_code === 'en');
        if (!hasEnglishSub) _loadExternalSubs(file, provider);

        // ── Audio Track Selector ──
        if (audioTracks.length > 1 && isMkv) {
            _buildAudioSelector(audioTracks, file, player, container);
        }

        if (audioTracks.length > 1) toast(`🎧 ${audioTracks.length} audio tracks: ${audioTracks.map(t => t.label).join(', ')}`, 'info');
        if (subtitleTracks.length) toast(`💬 ${subtitleTracks.length} subtitle tracks loaded`, 'info');
    } catch (e) {
        console.warn('Track detection failed:', e);
        const provider = player.querySelector('media-provider');
        if (provider) _loadExternalSubs(file, provider);
    }
}

async function _loadExternalSubs(file, provider) {
    try {
        const params = new URLSearchParams({ title: file.clean_name || file.title || '', lang: 'en' });
        if (file.year) params.set('year', file.year);
        if (file.season) params.set('season', file.season);
        if (file.episode) params.set('episode', file.episode);
        if (file.id) params.set('file_id', file.id); // enables AI fallback

        // Try subs space first, fallback to media server
        let res = await fetch(`${SUBS_BASE}/search?${params}`).catch(() => null);
        if (!res || !res.ok) {
            res = await fetch(`${MEDIA_BASE}/subtitles/search?${params}`).catch(() => null);
        }
        if (!res || !res.ok) return;

        const source = res.headers.get('X-Source') || 'external';
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const track = document.createElement('track');
        track.src = blobUrl;
        track.kind = 'subtitles';
        track.label = `English (${source})`;
        track.srclang = 'en';
        track.default = true;
        provider.appendChild(track);
        toast(`💬 English subtitles loaded (${source})`, 'success');
    } catch (e) { /* subtitles are optional */ }
}

function _buildAudioSelector(audioTracks, file, player, container) {
    const selector = document.createElement('div');
    selector.className = 'audio-track-selector';
    selector.innerHTML = `
        <button class="audio-track-btn" title="Audio Track">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            <span>${audioTracks[0].label}</span>
        </button>
        <div class="audio-track-dropdown" style="display:none">
            ${audioTracks.map((t, i) => `
                <div class="audio-track-option${i === 0 ? ' active' : ''}" data-index="${i}">
                    <span class="audio-track-check">${i === 0 ? '✓' : ''}</span>
                    <span class="audio-track-label">${t.label}</span>
                    <span class="audio-track-meta">${t.codec.toUpperCase()} ${t.channels > 2 ? t.channel_layout || '5.1' : 'Stereo'}</span>
                </div>
            `).join('')}
        </div>`;
    container.appendChild(selector);

    const btn = selector.querySelector('.audio-track-btn');
    const dropdown = selector.querySelector('.audio-track-dropdown');
    btn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'; });
    document.addEventListener('click', () => { dropdown.style.display = 'none'; });

    // Handle track selection — try native Vidstack audioTracks first, fallback to src swap
    selector.querySelectorAll('.audio-track-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(opt.dataset.index);
            const currentTime = player.currentTime || 0;

            // Update UI
            selector.querySelectorAll('.audio-track-option').forEach(o => {
                o.classList.remove('active');
                o.querySelector('.audio-track-check').textContent = '';
            });
            opt.classList.add('active');
            opt.querySelector('.audio-track-check').textContent = '✓';
            btn.querySelector('span').textContent = audioTracks[idx].label;
            dropdown.style.display = 'none';

            // Try native Vidstack/HLS.js audio track switching (no reload!)
            if (player.audioTracks && player.audioTracks.length > idx) {
                try {
                    const nativeTrack = player.audioTracks[idx];
                    if (nativeTrack) {
                        nativeTrack.selected = true;
                        toast(`🎧 Switched to: ${audioTracks[idx].label}`, 'success');
                        return; // Success — no src reload needed
                    }
                } catch (err) {
                    console.warn('Native audio switch failed, using fallback:', err);
                }
            }

            // Fallback: update player with new audio track param (for fMP4 remux streams)
            _showPlayerLoading(container, currentFile);
            player.style.opacity = '0';
            
            const newUrl = `${MEDIA_BASE}/stream/${file.id}?audio_track=${idx}&start=${currentTime}`;
            player.setAttribute('src', newUrl);
            
            player.addEventListener('can-play', () => {
                player.style.opacity = '1';
                _hidePlayerLoading(container);
                player.currentTime = currentTime;
            }, { once: true });

            toast(`🎧 Switched to: ${audioTracks[idx].label}`, 'success');
        });
    });
}


function toast(msg, type = 'info') {
    let c = document.getElementById('toastContainer');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toastContainer';
        c.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:10000;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(c);
    }
    const colors = { info: 'rgba(20,20,30,0.95)', success: 'rgba(16,42,28,0.95)', warning: 'rgba(50,40,10,0.95)', error: 'rgba(50,16,16,0.95)' };
    const t = document.createElement('div');
    t.style.cssText = `background:${colors[type]||colors.info};color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);max-width:350px;animation:fadeIn 0.3s ease;`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 4000);
}

// ═══ KEYBOARD SHORTCUTS ═══
document.addEventListener('keydown', (e) => {
    const player = document.querySelector('#player-container media-player');
    if (!player || document.getElementById('player-overlay')?.style.display === 'none') return;
    switch(e.key) {
        case ' ': e.preventDefault(); player.paused ? player.play() : player.pause(); break;
        case 'ArrowLeft': e.preventDefault(); player.currentTime = Math.max(0, (player.currentTime||0) - 10); break;
        case 'ArrowRight': e.preventDefault(); player.currentTime = (player.currentTime||0) + 10; break;
        case 'ArrowUp': e.preventDefault(); player.volume = Math.min(1, (player.volume||1) + 0.1); break;
        case 'ArrowDown': e.preventDefault(); player.volume = Math.max(0, (player.volume||1) - 0.1); break;
        case 'm': case 'M': player.muted = !player.muted; break;
        case 'f': case 'F': if(document.fullscreenElement) document.exitFullscreen(); else player.requestFullscreen?.(); break;
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('player-close')?.addEventListener('click', closePlayer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlayer(); });
});

function closePlayer() {
    const overlay = document.getElementById('player-overlay');
    overlay.classList.remove('active');
    _cancelNextEpisode();
    setTimeout(() => { overlay.style.display = 'none'; const p = document.querySelector('#player-container media-player'); if (p) p.remove(); document.querySelector('.player-loader')?.remove(); document.querySelector('.player-error')?.remove(); document.querySelector('.next-ep-overlay')?.remove(); document.querySelector('.quality-badge')?.remove(); }, 300);
}

// ═══ NEXT EPISODE AUTO-PLAY ═══
let _nextEpTimer = null;
let _nextEpCountdown = 15;

function _findNextEpisode(current) {
    if (!current || !allFiles) return null;
    const name = current.clean_name || current.name || '';
    // Match S01E01 or similar patterns
    const m = name.match(/[Ss](\d+)[Ee](\d+)/);
    if (!m) return null;
    const season = parseInt(m[1]);
    const ep = parseInt(m[2]);
    const nextEpStr = `S${String(season).padStart(2,'0')}E${String(ep+1).padStart(2,'0')}`;
    const series = name.replace(/[Ss]\d+[Ee]\d+.*$/, '').trim();
    return allFiles.find(f => {
        const fn = (f.clean_name || f.name || '').toUpperCase();
        return fn.includes(nextEpStr.toUpperCase()) && fn.includes(series.toUpperCase());
    });
}

function _showNextEpisode(nextFile) {
    const container = document.getElementById('player-container');
    if (!container) return;
    let overlay = container.querySelector('.next-ep-overlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'next-ep-overlay';
    overlay.style.cssText = 'position:absolute;bottom:80px;right:20px;z-index:60;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 20px;color:#fff;min-width:280px;animation:fadeIn 0.3s ease;';
    _nextEpCountdown = 15;
    overlay.innerHTML = `
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--accent,#FBBF24);margin-bottom:8px">Up Next</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:4px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nextFile.clean_name || nextFile.name}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:12px">Playing in <span class="next-ep-countdown">${_nextEpCountdown}</span>s</div>
        <div style="display:flex;gap:8px">
            <button class="next-ep-play" style="padding:6px 16px;border-radius:6px;background:var(--accent,#FBBF24);color:#000;border:none;font-weight:600;cursor:pointer;font-size:13px">Play Now</button>
            <button class="next-ep-cancel" style="padding:6px 16px;border-radius:6px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:13px">Cancel</button>
        </div>`;
    container.appendChild(overlay);

    overlay.querySelector('.next-ep-play')?.addEventListener('click', () => { _cancelNextEpisode(); playFile(nextFile); });
    overlay.querySelector('.next-ep-cancel')?.addEventListener('click', _cancelNextEpisode);

    _nextEpTimer = setInterval(() => {
        _nextEpCountdown--;
        const el = overlay.querySelector('.next-ep-countdown');
        if (el) el.textContent = _nextEpCountdown;
        if (_nextEpCountdown <= 0) { _cancelNextEpisode(); playFile(nextFile); }
    }, 1000);
}

function _cancelNextEpisode() {
    if (_nextEpTimer) { clearInterval(_nextEpTimer); _nextEpTimer = null; }
    document.querySelector('.next-ep-overlay')?.remove();
}

// ═══ QUALITY BADGE ═══
function _showQualityBadge(player, container) {
    let badge = container.querySelector('.quality-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'quality-badge';
        badge.style.cssText = 'position:absolute;top:12px;right:12px;z-index:55;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);padding:4px 10px;border-radius:6px;font-size:11px;color:var(--accent,#FBBF24);font-weight:600;letter-spacing:0.5px;pointer-events:none;';
        container.appendChild(badge);
    }
    const updateQuality = () => {
        try {
            const vt = player.qualities;
            if (vt && vt.length > 0) {
                const active = vt.find(q => q.selected);
                badge.textContent = active ? `${active.height}p` : 'AUTO';
            } else {
                badge.textContent = 'HLS';
            }
        } catch { badge.textContent = 'STREAM'; }
    };
    updateQuality();
    player.addEventListener('quality-change', updateQuality);
}

// ═══ PICTURE-IN-PICTURE ═══
document.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        const player = document.querySelector('#player-container media-player');
        if (!player) return;
        const video = player.querySelector('video');
        if (!video) return;
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled) {
            video.requestPictureInPicture().catch(() => {});
        }
    }
});

// ═══ MY LIST / CONTINUE WATCHING ═══
function getMyList() { try { return JSON.parse(localStorage.getItem('atmos_mylist') || '[]'); } catch { return []; } }
function setMyList(list) { localStorage.setItem('atmos_mylist', JSON.stringify(list)); }
function isInMyList(id) { return getMyList().includes(id); }
function toggleMyList(id) {
    let list = getMyList();
    if (list.includes(id)) list = list.filter(x => x !== id); else list.push(id);
    setMyList(list); renderMyList();
}
function renderMyList() {
    const list = getMyList();
    const row = document.getElementById('my-list-row');
    const grid = document.getElementById('my-list-grid');
    const items = allFiles.filter(f => list.includes(f.id));
    row.style.display = items.length ? '' : 'none';
    grid.innerHTML = items.map(f => cardHTML(f)).join('');
    grid.querySelectorAll('.card').forEach((card,i) => { card.addEventListener('click', () => openDetail(items[i])); });
    if (window.lucide) lucide.createIcons();
}

function saveProgress(id, time, duration) {
    if (!id || !duration || duration < 60) return;
    const pct = (time / duration) * 100;
    const data = JSON.parse(localStorage.getItem('atmos_progress') || '{}');
    data[id] = { time, duration, pct, ts: Date.now() };
    localStorage.setItem('atmos_progress', JSON.stringify(data));
}
function getProgress(id, raw) {
    const data = JSON.parse(localStorage.getItem('atmos_progress') || '{}');
    if (!data[id]) return 0;
    return raw ? data[id].time : data[id].pct;
}
function renderContinueWatching() {
    const data = JSON.parse(localStorage.getItem('atmos_progress') || '{}');
    const ids = Object.keys(data).filter(id => data[id].pct > 2 && data[id].pct < 95).sort((a,b) => data[b].ts - data[a].ts).slice(0,15);
    const items = ids.map(id => allFiles.find(f => f.id === id)).filter(Boolean);
    const row = document.getElementById('continue-watching-row');
    const grid = document.getElementById('continue-watching-grid');
    row.style.display = items.length ? '' : 'none';
    grid.innerHTML = items.map(f => cardHTML(f)).join('');
    grid.querySelectorAll('.card').forEach((card,i) => { card.addEventListener('click', () => playFile(items[i])); });
    if (window.lucide) lucide.createIcons();
}

// ═══ HORIZONTAL SCROLL ARROWS ═══
function initScrollArrows() {
    document.querySelectorAll('.row-arrow').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            if (!target) return;
            const dir = btn.classList.contains('row-arrow-left') ? -1 : 1;
            target.scrollBy({ left: dir * 400, behavior: 'smooth' });
        });
    });
}

// ═══ SCROLL REVEAL ═══
function initReveal() {
    const obs = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.content-row').forEach(el => { el.classList.add('reveal'); obs.observe(el); });
}

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', () => {
    initSplash();
    initAmbient();
    initNav();
    loadContent();
    initScrollArrows();
    initReveal();
    if (window.lucide) lucide.createIcons();
});
