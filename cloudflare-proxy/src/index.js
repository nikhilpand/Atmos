// ─── ATMOS V3.0 — Cloudflare Worker: Nuclear Ad-Block Proxy ────────────
// Dual Purpose Proxy:
// 1. CORS Proxy for @movie-web/providers (when ?destination= is passed)
// 2. Ad-Free Reverse Proxy for Vidlink.pro (when no destination is passed)
//
// This version performs DEEP rewriting of ALL JS bundles to:
//   - Strip ad library fetching (mercury, venus, popads, aclib, cloudfront ad CDN)
//   - Neuter sandbox detection (multiple detection vectors)
//   - Block window.open, top-navigation, and target=_blank

const HEADER_MAP = {
  'x-cookie': 'cookie',
  'x-referer': 'referer',
  'x-origin': 'origin',
  'x-user-agent': 'user-agent',
  'x-real-ip': 'x-real-ip',
};

const STRIP_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. CORS Preflight
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

    // 2. Check if this is the generic proxy or the Vidlink reverse proxy
    const destination = url.searchParams.get('destination');

    if (destination) {
      return handleGenericProxy(request, destination);
    } else {
      return handleVidlinkProxy(request, url);
    }
  },
};

// ─── GENERIC CORS PROXY (For movie-web Extractors) ───
async function handleGenericProxy(request, destination) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (HEADER_MAP[lowerKey]) {
      headers.set(HEADER_MAP[lowerKey], value);
    } else if (!lowerKey.startsWith('x-') && lowerKey !== 'host' && lowerKey !== 'connection') {
      headers.set(lowerKey, value);
    }
  }

  const upstreamRequest = new Request(destination, {
    method: request.method,
    headers: headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    redirect: 'follow',
  });

  try {
    const response = await fetch(upstreamRequest);
    const responseHeaders = new Headers();
    
    for (const [key, value] of response.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (!STRIP_HEADERS.includes(lowerKey) && lowerKey !== 'access-control-allow-origin') {
        responseHeaders.set(lowerKey, value);
      }
    }

    if (response.headers.has('set-cookie')) {
      responseHeaders.set('x-set-cookie', response.headers.get('set-cookie'));
      responseHeaders.delete('set-cookie');
    }

    if (response.url && response.url !== destination) {
      responseHeaders.set('x-final-destination', response.url);
    }

    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Expose-Headers', 'x-set-cookie, x-final-destination');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

// ─── AD-FREE VIDLINK REVERSE PROXY ───
async function handleVidlinkProxy(request, url) {
  const targetPath = url.pathname;
  
  // ═══════════════════════════════════════════════════════════════════
  // LAYER 1: BLOCK AD API ENDPOINTS COMPLETELY
  // These endpoints serve the ad libraries. Return empty/neutered JS.
  // ═══════════════════════════════════════════════════════════════════
  if (targetPath.includes('/api/mercury') || targetPath.includes('/api/venus')) {
    return new Response("<script>console.log('ATMOS: ad endpoint neutralized')</script>", {
      status: 200,
      headers: { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Block the WASM ad engine — return minimal valid WASM (8 bytes = magic + version)
  if (targetPath.endsWith('/fu.wasm')) {
    const minimalWasm = new Uint8Array([0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00]);
    return new Response(minimalWasm, {
      status: 200,
      headers: { 'Content-Type': 'application/wasm', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Block script.js (WASM loader + getAdv definer) — return neutered version
  if (targetPath === '/script.js') {
    return new Response(`
      // ATMOS: Neutered ad loader
      window.getAdv = function() { return null; };
      window.Dm = class { constructor() { this.importObject = {}; } run() {} };
      console.log('ATMOS: Ad loader neutralized');
    `, {
      status: 200,
      headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Block known ad CDN domains and patterns
  if (targetPath.includes('popads') || targetPath.includes('dcbbwymp') || targetPath.includes('cloudfront.net') || targetPath.includes('adcash')) {
    return new Response("/* ATMOS: blocked */", {
      status: 200,
      headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // LAYER 2: PROXY THE REQUEST TO VIDLINK
  // ═══════════════════════════════════════════════════════════════════
  const targetUrl = 'https://vidlink.pro' + targetPath + url.search;
  
  const proxyReqHeaders = new Headers(request.headers);
  proxyReqHeaders.set('Host', 'vidlink.pro');
  proxyReqHeaders.set('Origin', 'https://vidlink.pro');
  
  if (proxyReqHeaders.has('Referer')) {
     const newReferer = proxyReqHeaders.get('Referer').replace(url.host, 'vidlink.pro');
     proxyReqHeaders.set('Referer', newReferer);
  } else {
     proxyReqHeaders.set('Referer', 'https://vidlink.pro/');
  }

  const proxyReq = new Request(targetUrl, {
    method: request.method,
    headers: proxyReqHeaders,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    redirect: 'follow'
  });

  try {
    const res = await fetch(proxyReq);
    
    // Strip security headers that prevent iframe embedding
    const resHeaders = new Headers(res.headers);
    resHeaders.delete('X-Frame-Options');
    resHeaders.delete('Content-Security-Policy');
    resHeaders.delete('frame-ancestors');
    resHeaders.set('Access-Control-Allow-Origin', '*');

    const contentType = resHeaders.get('content-type') || '';

    // ═══════════════════════════════════════════════════════════════════
    // LAYER 3: DEEP REWRITE HTML AND ALL JS BUNDLES
    // ═══════════════════════════════════════════════════════════════════
    if (contentType.includes('text/html') || contentType.includes('javascript')) {
      let text = await res.text();
      
      // --- URL Rewriting: Make all vidlink.pro URLs point to our proxy ---
      text = text.replace(/https:\/\/vidlink\.pro/g, `https://${url.host}`);
      
      // ── NUCLEAR AD REMOVAL (works on both HTML inline scripts AND JS bundles) ──
      
      // 1. Kill the Adcash component (module 4883) — fetch("/api/mercury"...) 
      //    Replace the entire fetch-and-inject logic with a no-op
      text = text.replace(/fetch\(["']\/api\/mercury["']/g, 'fetch("/api/_blocked_mercury"');
      text = text.replace(/fetch\(["']\/api\/venus["']/g, 'fetch("/api/_blocked_venus"');
      
      // 2. Kill aclib.runPop calls
      text = text.replace(/window\.aclib\.runPop\(/g, 'console.log("ATMOS:blocked",');
      text = text.replace(/aclib\.runPop\(/g, 'console.log("ATMOS:blocked",');
      
      // 3. Kill the CloudFront ad script injection  
      text = text.replace(/dcbbwymp1bhlf\.cloudfront\.net/g, 'localhost');
      
      // 4. Kill popads script ID references
      text = text.replace(/"popads-script"/g, '"atmos-blocked"');
      
      // ── SANDBOX DETECTION NEUTRALIZATION ──
      
      // Strategy: Replace the sandbox detector function body.
      // The detector sets document.body.innerHTML to show "Please Disable Sandbox"
      // We need to neuter ALL the detection vectors:
      
      // Vector 1: frameElement.hasAttribute("sandbox") check
      text = text.replace(/\.hasAttribute\(["']sandbox["']\)/g, '.hasAttribute("atmos-never-match")');
      
      // Vector 2: The error message display function
      // Pattern: console.log("Sandboxed iframe detected"),document.body.innerHTML='...'
      text = text.replace(
        /console\.log\(["']Sandboxed iframe detected["']\)/g,
        'console.log("ATMOS: sandbox check bypassed")'
      );
      text = text.replace(
        /document\.body\.innerHTML='<div[^']*Please Disable Sandbox[^']*>'/g,
        'console.log("ATMOS: sandbox noop")'
      );
      
      // Vector 3: The document.domain assignment test
      // When sandboxed, setting document.domain throws; they catch it and check for "sandbox" in the error
      text = text.replace(
        /\.toString\(\)\.toLowerCase\(\)\.includes\(["']sandbox["']\)/g,
        '.toString().toLowerCase().includes("atmos-never-match")'
      );
      
      // Vector 4: Chrome PDF Viewer plugin test (sandbox blocks plugins)
      text = text.replace(
        /navigator\.plugins\.namedItem\(["']Chrome PDF Viewer["']\)/g,
        'true /* ATMOS: PDF check bypassed */'
      );

      // ── HTML-SPECIFIC: Inject our master protection script at the top ──
      if (contentType.includes('text/html')) {
        const masterScript = `<style>
/* ATMOS: Hide all ad containers */
[class*="banner"], [class*="adcash"], [id*="adcash"], [class*="ad-container"],
[class*="ad-overlay"], [class*="popup"], [data-adcash], [id*="popads"],
iframe[src*="adcash"], iframe[src*="cloudfront"], div[style*="z-index: 9999"],
div[style*="z-index:9999"], div[style*="z-index: 2147"] { display:none!important; visibility:hidden!important; }
</style>
<script>
// ═══ ATMOS Master Protection Layer ═══
(function() {
  // Kill the ad data provider function
  window.getAdv = function() { return null; };
  Object.defineProperty(window, 'getAdv', { value: function(){return null}, writable: false, configurable: false });
  
  // Block ALL popups
  window.open = function() { return null; };
  
  // Prevent scripts from detecting they're in a sandbox
  try {
    Object.defineProperty(window, 'frameElement', {
      get: function() { return null; },
      configurable: false
    });
  } catch(e) {}
  
  // Block top-level navigation
  try {
    Object.defineProperty(window, 'top', { value: window, writable: false, configurable: false });
  } catch(e) {}
  
  // Intercept ALL click events that try to open new tabs
  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (a && (a.target === '_blank' || a.href && a.href.indexOf(window.location.hostname) === -1)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  }, true);
  
  // Block form submissions to external URLs
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form.action && form.action.indexOf(window.location.hostname) === -1) {
      e.preventDefault();
      return false;
    }
  }, true);
  
  // Neuter beforeunload handlers from ad scripts
  var origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, fn, opts) {
    if (type === 'beforeunload') return;
    return origAddEventListener.call(this, type, fn, opts);
  };
  
  // MutationObserver: auto-remove any ad elements injected after page load
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        var el = node;
        var id = (el.id || '').toLowerCase();
        var cls = (el.className || '').toString().toLowerCase();
        if (id.includes('adcash') || id.includes('popads') || cls.includes('adcash') || cls.includes('banner')) {
          el.remove();
        }
        // Remove injected iframes from ad scripts
        if (el.tagName === 'IFRAME' && el.src && (el.src.includes('adcash') || el.src.includes('cloudfront'))) {
          el.remove();
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
</script>`;
        text = text.replace('<head>', '<head>' + masterScript);
      }

      // Remove content-length since we changed the body
      resHeaders.delete('content-length');
      return new Response(text, { status: res.status, headers: resHeaders });
    }
    
    // Return standard response for media/binary data
    return new Response(res.body, { status: res.status, headers: resHeaders });
    
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
}
