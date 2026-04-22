// ─── ATMOS V2.0 — Cloudflare Worker Proxy ──────────────────────────────
// This worker acts as a CORS proxy to bypass Cloudflare bot protection.
// It maps specific 'x-' headers required by @movie-web/providers to their
// true HTTP headers when forwarding the request to the target provider.

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
    // 1. Handle CORS Preflight Requests
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

    // 2. Parse the Destination URL
    const url = new URL(request.url);
    const destination = url.searchParams.get('destination');

    if (!destination) {
      return new Response(JSON.stringify({ error: 'Missing destination parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 3. Map Request Headers
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (HEADER_MAP[lowerKey]) {
        headers.set(HEADER_MAP[lowerKey], value);
      } else if (!lowerKey.startsWith('x-') && lowerKey !== 'host' && lowerKey !== 'connection') {
        headers.set(lowerKey, value);
      }
    }

    // 4. Create the Upstream Request
    const upstreamRequest = new Request(destination, {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'follow',
    });

    try {
      // 5. Fetch from Target
      const response = await fetch(upstreamRequest);

      // 6. Map Response Headers
      const responseHeaders = new Headers();
      for (const [key, value] of response.headers.entries()) {
        const lowerKey = key.toLowerCase();
        if (!STRIP_HEADERS.includes(lowerKey) && lowerKey !== 'access-control-allow-origin') {
          responseHeaders.set(lowerKey, value);
        }
      }

      // Map 'set-cookie' to 'x-set-cookie' so the browser doesn't intercept it
      if (response.headers.has('set-cookie')) {
        responseHeaders.set('x-set-cookie', response.headers.get('set-cookie'));
        responseHeaders.delete('set-cookie');
      }

      // Track final redirect destination
      if (response.url && response.url !== destination) {
        responseHeaders.set('x-final-destination', response.url);
      }

      // Inject CORS headers
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Expose-Headers', 'x-set-cookie, x-final-destination');

      // 7. Return Proxy Response
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
  },
};
