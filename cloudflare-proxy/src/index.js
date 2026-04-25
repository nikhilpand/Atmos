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
    if (destination) {
      return handleGenericProxy(request, destination);
    }
    return handleVidlinkProxy(request, url);
  },
};

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
