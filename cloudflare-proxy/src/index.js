// ─── ATMOS V5.0 — Universal Ad-Kill Reverse Proxy ──────────────────────
// Three modes:
//   1. ?destination=URL  → CORS proxy for @movie-web/providers
//   2. ?embed=URL        → UNIVERSAL reverse proxy for ANY embed provider
//   3. /path             → Legacy VidLink reverse proxy
//
// Mode 2 is the nuclear bypass: fetches any embed page, rewrites all
// resource URLs to route through us, injects undetectable JS overrides
// that replace sandbox functionality (popup block, nav lock, ad kill).

const HEADER_MAP = {
  'x-cookie': 'cookie',
  'x-referer': 'referer',
  'x-origin': 'origin',
  'x-user-agent': 'user-agent',
  'x-real-ip': 'x-real-ip',
};

const STRIP_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding'];

// Domains that serve ad scripts — block entirely
const AD_DOMAINS = [
  'popads.net', 'adcash.com', 'dcbbwymp1bhlf.cloudfront.net',
  'pagead2.googlesyndication.com', 'ad.doubleclick.net',
  'imasdk.googleapis.com', 'tpc.googlesyndication.com',
  'mc.yandex.ru', 'counter.yadro.ru', 'top-fwz1.mail.ru',
  'adblocker-bypass', 'syndication.exoclick.com',
  'juicyads.com', 'trafficjunky.com', 'tsyndicate.com',
  'a-ads.com', 'coinzillatag.com', 'ad-maven.com',
  'hilltopads.net', 'richads.com', 'propellerads.com',
  'pushground.com', 'clickadu.com', 'mondiad.com',
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Preflight
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

    const destination = url.searchParams.get('destination');
    const embed = url.searchParams.get('embed');

    if (destination) {
      return handleGenericProxy(request, destination);
    } else if (embed) {
      return handleUniversalEmbed(request, url, embed);
    }

    // ── SUB-RESOURCE REDIRECT ──
    // When an embed page loaded via ?embed= tries to fetch a sub-resource
    // (JS chunk, CSS, font, API call) using a relative URL, the browser
    // resolves it against our proxy domain. We catch those here and
    // redirect to the original embed domain.
    const referer = request.headers.get('referer') || '';
    const embedMatch = referer.match(/[?&]embed=([^&]+)/);
    if (embedMatch && url.pathname !== '/') {
      try {
        const originalEmbed = decodeURIComponent(embedMatch[1]);
        const originalOrigin = new URL(originalEmbed).origin;
        const redirectUrl = originalOrigin + url.pathname + url.search;
        return new Response(null, {
          status: 302,
          headers: {
            'Location': redirectUrl,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch(e) { /* fallthrough to vidlink handler */ }
    }

    return handleVidlinkProxy(request, url);
  },
};

// ─── GENERIC CORS PROXY ───
async function handleGenericProxy(request, destination) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lk = key.toLowerCase();
    if (HEADER_MAP[lk]) headers.set(HEADER_MAP[lk], value);
    else if (!lk.startsWith('x-') && lk !== 'host' && lk !== 'connection') headers.set(lk, value);
  }

  try {
    const response = await fetch(new Request(destination, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'follow',
    }));
    const rh = new Headers();
    for (const [key, value] of response.headers.entries()) {
      const lk = key.toLowerCase();
      if (!STRIP_HEADERS.includes(lk) && lk !== 'access-control-allow-origin') rh.set(lk, value);
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

// ═══════════════════════════════════════════════════════════════════════
// UNIVERSAL EMBED PROXY — The core bypass engine
// Takes any embed URL, proxies it, rewrites all resources through us,
// and injects invisible protection JS.
// ═══════════════════════════════════════════════════════════════════════
async function handleUniversalEmbed(request, proxyUrl, embedUrl) {
  let targetUrl;
  try {
    targetUrl = new URL(embedUrl);
  } catch {
    return new Response('Invalid embed URL', { status: 400 });
  }

  const targetOrigin = targetUrl.origin;
  const targetHost = targetUrl.hostname;

  // Block known ad domains
  if (AD_DOMAINS.some(d => targetHost.includes(d))) {
    return new Response('/* blocked */', {
      status: 200, headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Sub-resource request — the embed page loaded a relative asset
  const subRes = proxyUrl.searchParams.get('__res');
  const finalUrl = subRes ? new URL(subRes, targetOrigin).href : embedUrl;

  const reqHeaders = new Headers();
  reqHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  reqHeaders.set('Accept', '*/*');
  reqHeaders.set('Referer', targetOrigin + '/');
  reqHeaders.set('Origin', targetOrigin);
  reqHeaders.set('Host', new URL(finalUrl).hostname);

  try {
    const res = await fetch(finalUrl, { headers: reqHeaders, redirect: 'follow' });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const rh = new Headers();

    for (const [key, value] of res.headers.entries()) {
      const lk = key.toLowerCase();
      if (!STRIP_HEADERS.includes(lk) && lk !== 'x-frame-options' && lk !== 'content-security-policy' && lk !== 'access-control-allow-origin') {
        rh.set(lk, value);
      }
    }
    rh.delete('x-frame-options');
    rh.delete('content-security-policy');
    rh.set('Access-Control-Allow-Origin', '*');

    // Binary/media — pass through
    if (!ct.includes('text/html') && !ct.includes('javascript') && !ct.includes('text/css')) {
      return new Response(res.body, { status: res.status, headers: rh });
    }

    let text = await res.text();

    // ── Ad script neutralization (works on HTML and JS bundles) ──
    for (const ad of AD_DOMAINS) {
      text = text.replace(new RegExp(ad.replace(/\./g, '\\.'), 'g'), 'localhost');
    }
    text = text.replace(/fetch\(["']\/api\/mercury["']/g, 'fetch("/api/_dead"');
    text = text.replace(/fetch\(["']\/api\/venus["']/g, 'fetch("/api/_dead"');
    text = text.replace(/window\.aclib\.runPop\(/g, 'console.log("x",');
    text = text.replace(/aclib\.runPop\(/g, 'console.log("x",');
    text = text.replace(/"popads-script"/g, '"x-blocked"');

    // ── Sandbox detection neutralization ──
    text = text.replace(/\.hasAttribute\(["']sandbox["']\)/g, '.hasAttribute("x-never")');
    text = text.replace(/\.getAttribute\(["']sandbox["']\)/g, '.getAttribute("x-never")');
    text = text.replace(/console\.log\(["']Sandboxed iframe detected["']\)/g, 'console.log("ok")');
    text = text.replace(/["']sandbox["']\s*in\s/g, '"x-never" in ');
    text = text.replace(/\.sandbox\b/g, '.x_atmos_sandbox');
    text = text.replace(/Iframe Sandbox Detected/gi, 'ATMOS_OK');
    text = text.replace(/sandbox restrictions/gi, 'atmos_ok');
    text = text.replace(/Please Disable Sandbox/gi, 'ATMOS_OK');
    text = text.replace(/disable.*sandbox/gi, 'atmos_ok');

    // ── HTML: inject <base> tag + protection script ──
    // <base> makes ALL relative URLs resolve to the original embed origin
    // so JS/CSS/images load directly from the provider (no 404s)
    if (ct.includes('text/html')) {
      const baseTag = `<base href="${targetOrigin}/">`;
      const injection = getMasterProtectionScript(targetOrigin);
      const headInjection = baseTag + injection;
      if (text.includes('<head>')) {
        text = text.replace('<head>', '<head>' + headInjection);
      } else if (text.includes('<HEAD>')) {
        text = text.replace('<HEAD>', '<HEAD>' + headInjection);
      } else {
        text = headInjection + text;
      }
    }

    rh.delete('content-length');
    rh.set('content-type', ct);
    return new Response(text, { status: res.status, headers: rh });

  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MASTER PROTECTION SCRIPT — Injected into every proxied HTML page
// This replaces the browser sandbox attribute with undetectable JS
// ═══════════════════════════════════════════════════════════════════════
function getMasterProtectionScript(targetOrigin) {
  return `<style>
[class*="banner"],[class*="adcash"],[id*="adcash"],[class*="ad-container"],
[class*="ad-overlay"],[class*="popup"],[data-adcash],[id*="popads"],
iframe[src*="adcash"],iframe[src*="cloudfront"],
div[style*="z-index: 9999"],div[style*="z-index:9999"],
div[style*="z-index: 2147"],div[style*="z-index:2147483647"]{
  display:none!important;visibility:hidden!important;
  width:0!important;height:0!important;pointer-events:none!important;
}
</style>
<script>
// ═══ ATMOS V5.1 — Undetectable Protection Layer ═══
(function(){
  'use strict';
  var currentHost = window.location.hostname;

  // ── 1. POPUP KILLER ──
  var fakeWin = {
    closed: false, close: function(){this.closed=true},
    document: {write:function(){},close:function(){}},
    focus:function(){}, blur:function(){},
    postMessage:function(){}, location:{href:'about:blank'}
  };
  try {
    Object.defineProperty(window, 'open', {
      value: function(){ return fakeWin; },
      writable: false, configurable: false
    });
  } catch(e){ window.open = function(){ return fakeWin; }; }

  // ── 2. FRAME DETECTION KILLER ──
  try {
    Object.defineProperty(window, 'frameElement', {
      get: function(){ return null; },
      configurable: false
    });
  } catch(e){}
  try {
    Object.defineProperty(window, 'top', {
      get: function(){ return window; },
      configurable: false
    });
  } catch(e){}
  try {
    Object.defineProperty(window, 'parent', {
      get: function(){ return window; },
      configurable: false
    });
  } catch(e){}

  // ── 3. NAVIGATION LOCK (safe — no direct location property assignment) ──
  // Intercept location.assign/replace via prototype
  try {
    var locProto = Object.getPrototypeOf(window.location);
    var origAssign = locProto.assign;
    var origReplace = locProto.replace;
    locProto.assign = function(url){
      if (typeof url==='string' && (url.indexOf(currentHost)!==-1 || url.startsWith('/'))) {
        origAssign.call(this, url);
      }
    };
    locProto.replace = function(url){
      if (typeof url==='string' && (url.indexOf(currentHost)!==-1 || url.startsWith('/'))) {
        origReplace.call(this, url);
      }
    };
  } catch(e){}
  // Also intercept direct location.href set via history
  try {
    var origPushState = history.pushState;
    var origReplaceState = history.replaceState;
    history.pushState = function(){
      try { return origPushState.apply(this, arguments); } catch(e){}
    };
    history.replaceState = function(){
      try { return origReplaceState.apply(this, arguments); } catch(e){}
    };
  } catch(e){}

  // ── 4. EVENT INTERCEPTION ──
  var _origAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, fn, opts){
    // Block beforeunload (redirect trap)
    if (type === 'beforeunload') return;
    return _origAEL.call(this, type, fn, opts);
  };

  // ── 5. CLICK SANITIZER ──
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a) {
      var href = a.getAttribute('href') || '';
      // Block external links and target=_blank
      if (a.target === '_blank' || (href.startsWith('http') && href.indexOf(currentHost)===-1)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return false;
      }
    }
  }, true);

  // Block form submissions to external domains
  document.addEventListener('submit', function(e){
    var f = e.target;
    if (f && f.action && f.action.indexOf(currentHost)===-1) {
      e.preventDefault();
      return false;
    }
  }, true);

  // ── 6. DYNAMIC AD REMOVAL ──
  var obs = new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if (n.nodeType!==1) return;
        var id = (n.id||'').toLowerCase();
        var cls = (n.className||'').toString().toLowerCase();
        var tag = n.tagName;
        // Remove ad containers
        if (id.includes('adcash')||id.includes('popads')||cls.includes('adcash')||cls.includes('ad-overlay')) {
          n.remove(); return;
        }
        // Remove injected ad iframes
        if (tag==='IFRAME' && n.src) {
          var s = n.src.toLowerCase();
          if (s.includes('adcash')||s.includes('cloudfront')||s.includes('doubleclick')||s.includes('googlesyndication')) {
            n.remove(); return;
          }
        }
        // Remove high z-index overlays (ad popups)
        if (tag==='DIV' && n.style) {
          var z = parseInt(n.style.zIndex);
          if (z > 99999 && !n.querySelector('video')) {
            n.remove(); return;
          }
        }
      });
    });
  });
  if (document.documentElement) obs.observe(document.documentElement, {childList:true,subtree:true});

  // ── 7. SANDBOX ATTRIBUTE SPOOFER ──
  // If any script tries to read sandbox attribute from our iframe, return null
  var _origGetAttr = Element.prototype.getAttribute;
  Element.prototype.getAttribute = function(name){
    if (name === 'sandbox') return null;
    return _origGetAttr.call(this, name);
  };
  var _origHasAttr = Element.prototype.hasAttribute;
  Element.prototype.hasAttribute = function(name){
    if (name === 'sandbox') return false;
    return _origHasAttr.call(this, name);
  };

  // ── 8. AD FUNCTION NEUTRALIZATION ──
  Object.defineProperty(window, 'getAdv', { value:function(){return null}, writable:false, configurable:false });
  window.Dm = class { constructor(){this.importObject={}} run(){} };

  // ── 9. CORS PROXY — Route cross-origin fetch/XHR through our proxy ──
  // This is critical: since the page origin is our proxy domain, any
  // fetch() to the original embed domain gets CORS-blocked. We intercept
  // and route through ?destination= which adds CORS headers.
  var proxyOrigin = window.location.origin;
  var _origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      var url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
      // Only proxy absolute cross-origin URLs
      if (url.startsWith('http') && !url.startsWith(proxyOrigin)) {
        var proxiedUrl = proxyOrigin + '?destination=' + encodeURIComponent(url);
        if (typeof input === 'string') {
          return _origFetch.call(window, proxiedUrl, init);
        } else if (input instanceof Request) {
          // Clone request with new URL
          var newInit = init || {};
          return _origFetch.call(window, proxiedUrl, {
            method: input.method,
            headers: input.headers,
            body: input.body,
            mode: 'cors',
            credentials: 'omit',
            ...newInit
          });
        }
        return _origFetch.call(window, proxiedUrl, init);
      }
    } catch(e) {}
    return _origFetch.call(window, input, init);
  };

  // XMLHttpRequest override
  var _origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && url.startsWith('http') && !url.startsWith(proxyOrigin)) {
      arguments[1] = proxyOrigin + '?destination=' + encodeURIComponent(url);
    }
    return _origXHROpen.apply(this, arguments);
  };

  console.log('[ATMOS] Protection active');
})();
</script>`;
}

// ─── LEGACY VIDLINK REVERSE PROXY (kept for backward compat) ───
async function handleVidlinkProxy(request, url) {
  const tp = url.pathname;
  if (tp.includes('/api/mercury') || tp.includes('/api/venus')) {
    return new Response("<script>console.log('ATMOS: blocked')</script>", {
      status: 200, headers: { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' }
    });
  }
  if (tp.endsWith('/fu.wasm')) {
    return new Response(new Uint8Array([0,0x61,0x73,0x6d,1,0,0,0]), {
      status: 200, headers: { 'Content-Type': 'application/wasm', 'Access-Control-Allow-Origin': '*' }
    });
  }
  if (tp === '/script.js') {
    return new Response('window.getAdv=function(){return null};window.Dm=class{constructor(){this.importObject={}}run(){}};', {
      status: 200, headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' }
    });
  }
  if (AD_DOMAINS.some(d => tp.includes(d))) {
    return new Response('/* blocked */', {
      status: 200, headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const targetUrl = 'https://vidlink.pro' + tp + url.search;
  const h = new Headers(request.headers);
  h.set('Host', 'vidlink.pro');
  h.set('Origin', 'https://vidlink.pro');
  h.set('Referer', 'https://vidlink.pro/');

  try {
    const res = await fetch(targetUrl, { method: request.method, headers: h, body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined, redirect: 'follow' });
    const rh = new Headers(res.headers);
    rh.delete('X-Frame-Options');
    rh.delete('Content-Security-Policy');
    rh.set('Access-Control-Allow-Origin', '*');
    const ct = rh.get('content-type') || '';

    if (ct.includes('text/html') || ct.includes('javascript')) {
      let text = await res.text();
      text = text.replace(/https:\/\/vidlink\.pro/g, `https://${url.host}`);
      text = text.replace(/fetch\(["']\/api\/mercury["']/g, 'fetch("/api/_dead"');
      text = text.replace(/fetch\(["']\/api\/venus["']/g, 'fetch("/api/_dead"');
      text = text.replace(/window\.aclib\.runPop\(/g, 'console.log("x",');
      text = text.replace(/aclib\.runPop\(/g, 'console.log("x",');
      text = text.replace(/\.hasAttribute\(["']sandbox["']\)/g, '.hasAttribute("x-never")');
      text = text.replace(/\.getAttribute\(["']sandbox["']\)/g, '.getAttribute("x-never")');
      text = text.replace(/Iframe Sandbox Detected/gi, 'ATMOS_OK');
      text = text.replace(/sandbox restrictions/gi, 'atmos_ok');
      text = text.replace(/\.sandbox\b/g, '.x_sb');
      if (ct.includes('text/html')) {
        const injection = getMasterProtectionScript('https://vidlink.pro');
        text = text.replace('<head>', '<head>' + injection);
      }
      rh.delete('content-length');
      return new Response(text, { status: res.status, headers: rh });
    }
    return new Response(res.body, { status: res.status, headers: rh });
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
}
