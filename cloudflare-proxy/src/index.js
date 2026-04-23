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
    } else {
      return handleVidlinkProxy(request, url);
    }
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
    const proxyBase = `${proxyUrl.origin}?embed=${encodeURIComponent(embedUrl)}`;

    // ── Rewrite all absolute URLs to this embed's origin to go through proxy ──
    const originEscaped = targetOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(originEscaped, 'g'), proxyBase);
    // Also rewrite protocol-relative URLs
    text = text.replace(new RegExp(`//${targetHost.replace(/\./g, '\\.')}`, 'g'), `//${proxyUrl.host}?embed=${encodeURIComponent(embedUrl)}&__res=`);

    // ── Rewrite relative src/href to go through proxy ──
    text = text.replace(/(src|href|action)=(["'])\//g, `$1=$2${proxyBase}&__res=/`);

    // ── Ad script neutralization ──
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
    // Catch any innerHTML replacement mentioning sandbox
    text = text.replace(/Iframe Sandbox Detected/gi, 'ATMOS_OK');
    text = text.replace(/sandbox restrictions/gi, 'atmos_ok');
    text = text.replace(/Please Disable Sandbox/gi, 'ATMOS_OK');
    text = text.replace(/disable.*sandbox/gi, 'atmos_ok');

    // ── Inject Master Protection Script into HTML ──
    if (ct.includes('text/html')) {
      const injection = getMasterProtectionScript(proxyBase, embedUrl);
      // Inject before first <script> or after <head>
      if (text.includes('<head>')) {
        text = text.replace('<head>', '<head>' + injection);
      } else if (text.includes('<HEAD>')) {
        text = text.replace('<HEAD>', '<HEAD>' + injection);
      } else {
        text = injection + text;
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
function getMasterProtectionScript(proxyBase, embedUrl) {
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
// ═══ ATMOS V5 — Undetectable Protection Layer ═══
(function(){
  'use strict';

  // ── 1. POPUP KILLER ──
  // Override window.open to silently return a fake window object
  // This is undetectable because the caller gets back a "valid" window
  var fakeWin = {
    closed: false, close: function(){this.closed=true},
    document: {write:function(){},close:function(){}},
    focus:function(){}, blur:function(){},
    postMessage:function(){}, location:{href:'about:blank'}
  };
  Object.defineProperty(window, 'open', {
    value: function(){ return fakeWin; },
    writable: false, configurable: false
  });

  // ── 2. FRAME DETECTION KILLER ──
  // Make the page think it's NOT inside any frame at all
  try {
    Object.defineProperty(window, 'frameElement', {
      get: function(){ return null; },
      configurable: false
    });
  } catch(e){}

  // Make window.top === window.self (looks like top-level)
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

  // ── 3. NAVIGATION LOCK ──
  // Prevent any script from navigating away
  var _loc = window.location;
  var _origAssign = _loc.assign;
  var _origReplace = _loc.replace;
  var currentHost = _loc.hostname;

  // Only allow navigation to same host
  _loc.assign = function(url){
    if (typeof url==='string' && (url.indexOf(currentHost)!==-1 || url.startsWith('/'))) {
      _origAssign.call(_loc, url);
    }
  };
  _loc.replace = function(url){
    if (typeof url==='string' && (url.indexOf(currentHost)!==-1 || url.startsWith('/'))) {
      _origReplace.call(_loc, url);
    }
  };

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
        const injection = getMasterProtectionScript(`https://${url.host}`, 'https://vidlink.pro');
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
