const HEADER_MAP = {
  'x-cookie': 'cookie',
  'x-referer': 'referer',
  'x-origin': 'origin',
  'x-user-agent': 'user-agent',
  'x-real-ip': 'x-real-ip',
};

const STRIP_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding'];

// ─── Security Headers (applied to ALL responses) ───────────────
function addSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('X-XSS-Protection', '1; mode=block');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type, x-cookie, x-referer, x-origin, x-user-agent, x-real-ip',
          'Access-Control-Expose-Headers': 'x-set-cookie, x-final-destination',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // HLS segment edge caching (.m3u8 and .ts files)
    if (url.pathname.match(/\.(m3u8|ts)$/i)) {
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;
      let cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const headers = new Headers(cachedResponse.headers);
        headers.set('X-Atmos-Cache', 'HIT-EDGE');
        return addSecurityHeaders(new Response(cachedResponse.body, { ...cachedResponse, headers }));
      }
    }

    const destination = url.searchParams.get('destination');
    if (destination) {
      return addSecurityHeaders(await handleGenericProxy(request, destination));
    }
    
    // TMDB Edge Cache Proxy (e.g. /tmdb/3/movie/popular)
    if (url.pathname.startsWith('/tmdb/')) {
      return addSecurityHeaders(await handleTmdbProxy(request, url, ctx));
    }

    // Health Aggregation API
    if (url.pathname === '/api/health') {
      return addSecurityHeaders(await handleHealthApi(request, env));
    }

    const response = await handleVidlinkProxy(request, url);

    // Cache HLS segments at the edge for 1 hour
    if (url.pathname.match(/\.(m3u8|ts)$/i) && response.status === 200) {
      const toCache = response.clone();
      const cacheHeaders = new Headers(toCache.headers);
      cacheHeaders.set('Cache-Control', 'public, max-age=3600');
      ctx.waitUntil(caches.default.put(new Request(url.toString(), request), new Response(toCache.body, { headers: cacheHeaders })));
    }

    return addSecurityHeaders(response);
  },
};

// In-memory cache for TMDB responses (lives as long as the worker isolate)
const tmdbMemCache = new Map();

async function handleTmdbProxy(request, url, ctx) {
  const urlStr = url.toString();
  
  // Try in-memory cache first
  if (tmdbMemCache.has(urlStr)) {
    const cached = tmdbMemCache.get(urlStr);
    if (Date.now() < cached.exp) {
      const headers = new Headers(cached.headers);
      headers.set('X-Atmos-Cache', 'HIT-MEM');
      return new Response(cached.body, { status: 200, headers });
    } else {
      tmdbMemCache.delete(urlStr);
    }
  }

  // Rewrite /tmdb/... to https://api.themoviedb.org/...
  const tmdbPath = url.pathname.replace('/tmdb', '');
  const tmdbUrl = `https://api.themoviedb.org${tmdbPath}${url.search}`;
  
  try {
    const response = await fetch(tmdbUrl, {
      headers: {
        'Accept': 'application/json',
        ...(request.headers.has('Authorization') ? { 'Authorization': request.headers.get('Authorization') } : {})
      }
    });

    // Cache successful GET responses for 6 hours
    if (response.status === 200 && request.method === 'GET') {
      const bodyText = await response.clone().text();
      tmdbMemCache.set(urlStr, {
        body: bodyText,
        headers: Object.fromEntries(response.headers.entries()),
        exp: Date.now() + 21600 * 1000 // 6 hours
      });
      
      // Keep cache size bounded (max 1000 items)
      if (tmdbMemCache.size > 1000) {
        const firstKey = tmdbMemCache.keys().next().value;
        tmdbMemCache.delete(firstKey);
      }
    }

    const headers = new Headers(response.headers);
    headers.set('X-Atmos-Cache', 'MISS');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=21600'); // Tell browser to cache for 6 hours
    
    return new Response(response.body, { ...response, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// Provider Health Tracker (lives as long as the worker isolate)
const healthStats = new Map();

async function handleHealthApi(request, env) {
  // Handle POST: report health
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const { provider_id, success } = body;
      
      if (provider_id) {
        if (!healthStats.has(provider_id)) {
          healthStats.set(provider_id, { successes: 0, failures: 0, lastUpdate: Date.now() });
        }
        
        const stats = healthStats.get(provider_id);
        if (success) stats.successes++;
        else stats.failures++;
        stats.lastUpdate = Date.now();
        
        healthStats.set(provider_id, stats);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
  }

  // Handle GET: retrieve health leaderboard
  const providers = [];
  for (const [id, stats] of healthStats.entries()) {
    const total = stats.successes + stats.failures;
    const reliability = total > 0 ? (stats.successes / total) * 100 : 100;
    providers.push({
      id,
      reliability,
      total_requests: total,
      last_update: stats.lastUpdate
    });
  }

  return new Response(JSON.stringify({ status: 'healthy', providers }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

async function handleGenericProxy(request, destination) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lk = key.toLowerCase();
    if (HEADER_MAP[lk]) {
      headers.set(HEADER_MAP[lk], value);
    } else if (!lk.startsWith('x-') && lk !== 'host' && lk !== 'connection') {
      headers.set(lk, value);
    }
  }

  try {
    const response = await fetch(new Request(destination, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'follow',
    }));

    const rh = new Headers();
    for (const [k, v] of response.headers.entries()) {
      const lk = k.toLowerCase();
      if (!STRIP_HEADERS.includes(lk) && lk !== 'access-control-allow-origin') rh.set(lk, v);
    }
    if (response.headers.has('set-cookie')) {
      rh.set('x-set-cookie', response.headers.get('set-cookie'));
      rh.delete('set-cookie');
    }
    if (response.url && response.url !== destination) rh.set('x-final-destination', response.url);
    rh.set('Access-Control-Allow-Origin', '*');
    rh.set('Access-Control-Expose-Headers', 'x-set-cookie, x-final-destination');

    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: rh });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

async function handleVidlinkProxy(request, url) {
  const path = url.pathname;
  const host = url.host;

  // Stub internal ad endpoints
  if (path.includes('/api/mercury') || path.includes('/api/venus')) {
    return stub('application/json', '{"success":true,"data":{}}');
  }
  if (path === '/script.js') {
    return stub('application/javascript', 'window.getAdv=function(){return null};window.Dm=class{constructor(){this.importObject={}}run(){}};');
  }
  if (path.endsWith('.wasm')) {
    return new Response(new Uint8Array([0,0x61,0x73,0x6d,1,0,0,0]), {
      status: 200, headers: { 'Content-Type': 'application/wasm', 'Access-Control-Allow-Origin': '*' },
    });
  }
  if (/popads|dcbbwymp|adcash|aclib/.test(path)) {
    return stub('application/javascript', '/* ATMOS:blocked */');
  }

  const targetUrl = 'https://vidlink.pro' + path + url.search;
  const ph = new Headers(request.headers);
  ph.set('Host', 'vidlink.pro');
  ph.set('Origin', 'https://vidlink.pro');
  ph.set('Referer', ph.has('Referer') ? ph.get('Referer').replace(host, 'vidlink.pro') : 'https://vidlink.pro/');
  ph.delete('Accept-Encoding');

  let res;
  try {
    res = await fetch(new Request(targetUrl, {
      method: request.method,
      headers: ph,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'follow',
    }));
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }

  const rh = new Headers(res.headers);
  rh.delete('X-Frame-Options');
  rh.delete('Content-Security-Policy');
  rh.delete('frame-ancestors');
  rh.delete('content-encoding');
  rh.delete('content-length');
  rh.set('Access-Control-Allow-Origin', '*');

  const ct = (rh.get('content-type') || '').toLowerCase();

  // INJECT PROTECTION VIA JS CHUNKS
  // This completely avoids React hydration errors because we don't modify the HTML at all.
  if (ct.includes('javascript') && path.includes('/_next/static/chunks/') && path.includes('main-app-')) {
    let js = await res.text();
    js += '\n\n' + MASTER_PROTECTION_JS;
    return new Response(js, { status: res.status, headers: rh });
  }

  // Pass everything else through untouched (no HTML modification = perfect hydration)
  return new Response(res.body, { status: res.status, headers: rh });
}

function stub(contentType, body) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' },
  });
}

// ── JS: client-side runtime protection ──
// Runs globally within the Next.js chunk to nuke ads and trackers instantly
const MASTER_PROTECTION_JS = `
(function(){
  try {
    // 1. Inject CSS dynamically
    var style = document.createElement('style');
    style.innerHTML = \`
      [class*="adcash"],[id*="adcash"],[id*="popads"],[data-adcash],
      iframe[src*="adcash"],iframe[src*="cloudfront.net/fu"],
      div[style*="z-index: 2147483647"],div[style*="z-index:2147483647"],
      noscript img[src*="yandex"],img[src*="mc.yandex.ru"]{
        display:none!important;visibility:hidden!important;width:0!important;height:0!important;pointer-events:none!important;
      }
    \`;
    document.documentElement.appendChild(style);

    // 2. Kill ad data provider
    Object.defineProperty(window,'getAdv',{value:function(){return null},writable:false,configurable:false});

    // 3. Block popups
    window.open=function(){return null};

    // 4. Kill tracking globals
    window.ym=function(){};window.gtag=function(){};window.dataLayer=[];
    Object.defineProperty(window,'aclib',{value:{runPop:function(){},setup:function(){}},writable:false,configurable:false});

    // 5. Intercept clicks
    document.addEventListener('click',function(e){
      var a=e.target&&e.target.closest?e.target.closest('a'):null;
      if(a&&(a.target==='_blank'||(a.href&&a.href.indexOf(location.hostname)===-1))){
        e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      }
    },true);

    // 6. MutationObserver to auto-remove elements dynamically added by React
    new MutationObserver(function(ms){
      ms.forEach(function(m){m.addedNodes.forEach(function(n){
        if(n.nodeType!==1)return;
        var s=(n.src||'').toLowerCase(),h=(n.href||'').toLowerCase(),
            id=(n.id||'').toLowerCase(),cl=(n.className||'').toString().toLowerCase();
        
        if(n.tagName==='SCRIPT'&&(s.includes('popads')||s.includes('adcash')||s.includes('yandex')||s.includes('clarity.ms')||s.includes('googletagmanager'))){n.remove();return}
        if(n.tagName==='IFRAME'&&(s.includes('adcash')||s.includes('cloudfront'))){n.remove();return}
        if(n.tagName==='LINK'&&(h.includes('yandex')||h.includes('clarity.ms')||h.includes('googletagmanager'))){n.remove();return}
        if(id.includes('adcash')||id.includes('popads')||cl.includes('adcash')){n.remove();return}
        
        if(n.style&&parseInt(n.style.zIndex)>9000&&n.tagName==='DIV'){
          var r=n.getBoundingClientRect();
          if(r.width>window.innerWidth*0.4&&r.height>window.innerHeight*0.25){n.remove();return}
        }
      })});
    }).observe(document.documentElement,{childList:true,subtree:true});
    console.log("ATMOS: Protection active.");
  } catch(err) {
    console.error("ATMOS Protection Error:", err);
  }
})();
`;
