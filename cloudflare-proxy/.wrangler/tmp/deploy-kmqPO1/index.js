var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var HEADER_MAP = {
  "x-cookie": "cookie",
  "x-referer": "referer",
  "x-origin": "origin",
  "x-user-agent": "user-agent",
  "x-real-ip": "x-real-ip"
};
var STRIP_HEADERS = ["content-encoding", "content-length", "transfer-encoding"];
var BLOCKED_DOMAINS = [
  "mc.yandex.ru",
  "yandex.ru/metrika",
  "clarity.ms",
  "googletagmanager.com",
  "google-analytics.com",
  "popads.net",
  "adcash.com",
  "dcbbwymp",
  "cloudfront.net/fu",
  "aclib.js"
];
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type, x-cookie, x-referer, x-origin, x-user-agent, x-real-ip",
          "Access-Control-Expose-Headers": "x-set-cookie, x-final-destination",
          "Access-Control-Max-Age": "86400"
        }
      });
    }
    const destination = url.searchParams.get("destination");
    if (destination) {
      return handleGenericProxy(request, destination);
    } else {
      return handleVidlinkProxy(request, url);
    }
  }
};
async function handleGenericProxy(request, destination) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (HEADER_MAP[lowerKey]) {
      headers.set(HEADER_MAP[lowerKey], value);
    } else if (!lowerKey.startsWith("x-") && lowerKey !== "host" && lowerKey !== "connection") {
      headers.set(lowerKey, value);
    }
  }
  const upstreamRequest = new Request(destination, {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : void 0,
    redirect: "follow"
  });
  try {
    const response = await fetch(upstreamRequest);
    const responseHeaders = new Headers();
    for (const [key, value] of response.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (!STRIP_HEADERS.includes(lowerKey) && lowerKey !== "access-control-allow-origin") {
        responseHeaders.set(lowerKey, value);
      }
    }
    if (response.headers.has("set-cookie")) {
      responseHeaders.set("x-set-cookie", response.headers.get("set-cookie"));
      responseHeaders.delete("set-cookie");
    }
    if (response.url && response.url !== destination) {
      responseHeaders.set("x-final-destination", response.url);
    }
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Expose-Headers", "x-set-cookie, x-final-destination");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
__name(handleGenericProxy, "handleGenericProxy");
async function handleVidlinkProxy(request, url) {
  const targetPath = url.pathname;
  for (const domain of BLOCKED_DOMAINS) {
    if (targetPath.includes(domain)) {
      return new Response("/* ATMOS: blocked */", {
        status: 200,
        headers: { "Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*" }
      });
    }
  }
  if (targetPath.includes("/api/mercury") || targetPath.includes("/api/venus")) {
    return new Response("<script>console.log('ATMOS: ad endpoint neutralized')<\/script>", {
      status: 200,
      headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (targetPath.endsWith("/fu.wasm") || targetPath.endsWith(".wasm")) {
    const minimalWasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    return new Response(minimalWasm, {
      status: 200,
      headers: { "Content-Type": "application/wasm", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (targetPath === "/script.js") {
    return new Response(`
      // ATMOS: Neutered ad loader
      window.getAdv = function() { return null; };
      window.Dm = class { constructor() { this.importObject = {}; } run() {} };
      console.log('ATMOS: Ad loader neutralized');
    `, {
      status: 200,
      headers: { "Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (targetPath.includes("popads") || targetPath.includes("dcbbwymp") || targetPath.includes("adcash") || targetPath.includes("aclib")) {
    return new Response("/* ATMOS: blocked */", {
      status: 200,
      headers: { "Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*" }
    });
  }
  if (targetPath.includes("/watch/") && targetPath.includes("yandex") || targetPath.includes("clarity") || targetPath.includes("gtag")) {
    return new Response("/* ATMOS: tracking blocked */", {
      status: 200,
      headers: { "Content-Type": "application/javascript", "Access-Control-Allow-Origin": "*" }
    });
  }
  const targetUrl = "https://vidlink.pro" + targetPath + url.search;
  const proxyReqHeaders = new Headers(request.headers);
  proxyReqHeaders.set("Host", "vidlink.pro");
  proxyReqHeaders.set("Origin", "https://vidlink.pro");
  if (proxyReqHeaders.has("Referer")) {
    const newReferer = proxyReqHeaders.get("Referer").replace(url.host, "vidlink.pro");
    proxyReqHeaders.set("Referer", newReferer);
  } else {
    proxyReqHeaders.set("Referer", "https://vidlink.pro/");
  }
  const proxyReq = new Request(targetUrl, {
    method: request.method,
    headers: proxyReqHeaders,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : void 0,
    redirect: "follow"
  });
  try {
    const res = await fetch(proxyReq);
    const resHeaders = new Headers(res.headers);
    resHeaders.delete("X-Frame-Options");
    resHeaders.delete("Content-Security-Policy");
    resHeaders.delete("frame-ancestors");
    resHeaders.set("Access-Control-Allow-Origin", "*");
    const contentType = resHeaders.get("content-type") || "";
    if (contentType.includes("text/html") || contentType.includes("javascript")) {
      let text = await res.text();
      text = text.replace(/https:\/\/vidlink\.pro/g, `https://${url.host}`);
      text = text.replace(/fetch\(["']\/api\/mercury["']/g, 'fetch("/api/_blocked_mercury"');
      text = text.replace(/fetch\(["']\/api\/venus["']/g, 'fetch("/api/_blocked_venus"');
      text = text.replace(/window\.aclib\.runPop\(/g, 'console.log("ATMOS:blocked",');
      text = text.replace(/aclib\.runPop\(/g, 'console.log("ATMOS:blocked",');
      text = text.replace(/dcbbwymp1bhlf\.cloudfront\.net/g, "localhost");
      text = text.replace(/"popads-script"/g, '"atmos-blocked"');
      text = text.replace(
        /createElement\(["']script["']\)[\s\S]*?\.src\s*=\s*["'][^"']*(?:adcash|popads|cloudfront)[^"']*["']/g,
        'createElement("script");/* ATMOS: ad script blocked */'
      );
      text = text.replace(/\blimitAds\b\s*[=:]\s*false/g, "limitAds:true");
      text = text.replace(/\blimitAds\b\s*[=:]\s*!1/g, "limitAds:!0");
      text = text.replace(/mc\.yandex\.ru\/watch\/\d+/g, "localhost/noop");
      text = text.replace(/mc\.yandex\.ru\/metrika\/tag\.js/g, "localhost/noop.js");
      text = text.replace(/ym\(\d+,\s*["']init["']/g, 'console.log("ATMOS:ym-blocked"');
      text = text.replace(/clarity\.ms\/tag\/[a-z0-9]+/g, "localhost/noop");
      text = text.replace(/googletagmanager\.com\/gtag\/js\?id=[A-Z0-9-]+/g, "localhost/noop.js");
      text = text.replace(/gtag\(['"]config['"],\s*['"][A-Z0-9-]+['"]\)/g, 'console.log("ATMOS:gtag-blocked")');
      text = text.replace(/\.hasAttribute\(["']sandbox["']\)/g, '.hasAttribute("atmos-never-match")');
      text = text.replace(
        /console\.log\(["']Sandboxed iframe detected["']\)/g,
        'console.log("ATMOS: sandbox check bypassed")'
      );
      text = text.replace(
        /document\.body\.innerHTML='<div[^']*Please Disable Sandbox[^']*>'/g,
        'console.log("ATMOS: sandbox noop")'
      );
      text = text.replace(
        /\.toString\(\)\.toLowerCase\(\)\.includes\(["']sandbox["']\)/g,
        '.toString().toLowerCase().includes("atmos-never-match")'
      );
      text = text.replace(
        /navigator\.plugins\.namedItem\(["']Chrome PDF Viewer["']\)/g,
        "true /* ATMOS: PDF check bypassed */"
      );
      if (contentType.includes("text/html")) {
        const masterScript = `<style>
/* ATMOS: Hide all ad containers */
[class*="banner"], [class*="adcash"], [id*="adcash"], [class*="ad-container"],
[class*="ad-overlay"], [class*="popup"], [data-adcash], [id*="popads"],
iframe[src*="adcash"], iframe[src*="cloudfront"], div[style*="z-index: 9999"],
div[style*="z-index:9999"], div[style*="z-index: 2147"],
div[style*="z-index:2147483647"], div[style*="position: fixed"][style*="z-index"],
/* Hide Yandex Metrika noscript tracking pixel */
noscript img[src*="yandex"], img[src*="mc.yandex.ru"] { display:none!important; visibility:hidden!important; width:0!important; height:0!important; }
</style>
<script>
// \u2550\u2550\u2550 ATMOS V4.0 Master Protection Layer \u2550\u2550\u2550
(function() {
  // Kill the ad data provider function
  window.getAdv = function() { return null; };
  Object.defineProperty(window, 'getAdv', { value: function(){return null}, writable: false, configurable: false });
  
  // Block ALL popups
  window.open = function() { return null; };
  
  // Block tracking functions
  window.ym = function() {};
  window.gtag = function() {};
  window.dataLayer = [];
  
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
        var src = (el.src || '').toLowerCase();
        var href = (el.href || '').toLowerCase();
        
        // Remove ad containers
        if (id.includes('adcash') || id.includes('popads') || cls.includes('adcash') || cls.includes('banner')) {
          el.remove();
          return;
        }
        // Remove injected iframes from ad scripts
        if (el.tagName === 'IFRAME' && el.src && (src.includes('adcash') || src.includes('cloudfront'))) {
          el.remove();
          return;
        }
        // Remove injected tracking scripts
        if (el.tagName === 'SCRIPT' && (src.includes('yandex') || src.includes('clarity.ms') || src.includes('googletagmanager') || src.includes('popads') || src.includes('adcash'))) {
          el.remove();
          return;
        }
        // Remove tracking link preloads
        if (el.tagName === 'LINK' && (href.includes('yandex') || href.includes('clarity.ms') || href.includes('googletagmanager'))) {
          el.remove();
          return;
        }
        // Remove high z-index overlay ads
        if (el.style && el.style.zIndex && parseInt(el.style.zIndex) > 9000 && el.tagName === 'DIV') {
          var rect = el.getBoundingClientRect();
          // Only remove if it looks like a fullscreen overlay (not player controls)
          if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.3) {
            el.remove();
            return;
          }
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  
  // Remove existing tracking elements on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function() {
    // Remove Yandex tracking pixels
    document.querySelectorAll('img[src*="yandex"], noscript img[src*="yandex"]').forEach(function(el) { el.remove(); });
    // Remove tracking link preloads
    document.querySelectorAll('link[href*="yandex"], link[href*="clarity.ms"], link[href*="googletagmanager"]').forEach(function(el) { el.remove(); });
    // Remove tracking scripts
    document.querySelectorAll('script[src*="yandex"], script[src*="clarity.ms"], script[src*="googletagmanager"]').forEach(function(el) { el.remove(); });
    // Remove inline tracking scripts
    document.querySelectorAll('script#yandex-metrika, script#clarity-script, script#google-analytics').forEach(function(el) { el.remove(); });
  });
})();
<\/script>`;
        text = text.replace("<head>", "<head>" + masterScript);
        text = text.replace(/<link[^>]*href="[^"]*(?:mc\.yandex\.ru|clarity\.ms|googletagmanager\.com)[^"]*"[^>]*>/gi, "");
        text = text.replace(/<script[^>]*src="[^"]*(?:mc\.yandex\.ru|clarity\.ms|googletagmanager\.com)[^"]*"[^>]*>[\s\S]*?<\/script>/gi, "");
        text = text.replace(/<script[^>]*id="(?:yandex-metrika|clarity-script|google-analytics)"[^>]*>[\s\S]*?<\/script>/gi, "");
        text = text.replace(/<noscript>[\s\S]*?mc\.yandex\.ru[\s\S]*?<\/noscript>/gi, "");
        text = text.replace(/<link[^>]*href="[^"]*cdn\.jwplayer\.com[^"]*"[^>]*>/gi, "");
      }
      resHeaders.delete("content-length");
      return new Response(text, { status: res.status, headers: resHeaders });
    }
    return new Response(res.body, { status: res.status, headers: resHeaders });
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
}
__name(handleVidlinkProxy, "handleVidlinkProxy");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
