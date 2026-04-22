// ─── ATMOS V2.0 — Cloudflare Worker Proxy ──────────────────────────────
// Dual Purpose Proxy:
// 1. CORS Proxy for @movie-web/providers (when ?destination= is passed)
// 2. Ad-Free Reverse Proxy for Vidlink.pro (when no destination is passed)

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
  
  // 1. HARDCORE AD BLOCKING
  // Vidlink loads "Adcash" from /api/mercury and "PopAds" from /api/venus
  if (targetPath.includes('/api/mercury') || targetPath.includes('/api/venus') || targetPath.includes('popads')) {
    return new Response("console.log('ATMOS Ad-Blocker: Neutralized Popup Script');", {
      status: 200,
      headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // 2. Construct target URL
  const targetUrl = 'https://vidlink.pro' + targetPath + url.search;
  
  // 3. Prepare proxy request headers
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
    
    // 4. Strip security headers that prevent iframe embedding
    const resHeaders = new Headers(res.headers);
    resHeaders.delete('X-Frame-Options');
    resHeaders.delete('Content-Security-Policy');
    resHeaders.delete('frame-ancestors');
    
    // Add CORS
    resHeaders.set('Access-Control-Allow-Origin', '*');

    // 5. Rewrite HTML absolute URLs to point to our proxy
    const contentType = resHeaders.get('content-type') || '';
    if (contentType.includes('text/html') || contentType.includes('application/javascript') || contentType.includes('text/javascript')) {
      let text = await res.text();
      // Replace absolute URLs
      text = text.replace(/https:\/\/vidlink\.pro/g, `https://${url.host}`);
      
      if (contentType.includes('text/html')) {
        const adBlockScript = `<script>
          // ATMOS Aggressive Popup & Redirect Blocker
          window.open = function() { console.log('ATMOS blocked window.open'); return null; };
          // Disable top level navigation
          Object.defineProperty(window, 'top', { value: window, writable: false, configurable: false });
          document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link && link.target === '_blank') {
              e.preventDefault();
              console.log('ATMOS blocked target=_blank click');
            }
          }, true);
        </script>`;
        text = text.replace('<head>', '<head>' + adBlockScript);
      }

      if (contentType.includes('application/javascript') || contentType.includes('text/javascript')) {
        // Neuter Vidlink's sandbox detector so we can safely use the sandbox attribute
        text = text.replace(/console\.log\("Sandboxed iframe detected"\),document\.body\.innerHTML='<div[^>]*><h1>Please Disable Sandbox<\/h1><\/div>'/g, 'console.log("ATMOS: Sandbox check bypassed")');
      }

      return new Response(text, { status: res.status, headers: resHeaders });
    }
    
    // Return standard response for media/binary data
    return new Response(res.body, { status: res.status, headers: resHeaders });
    
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
}
