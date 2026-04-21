import { NextRequest, NextResponse } from 'next/server';

const headerMap: Record<string, string> = {
  'x-cookie': 'cookie',
  'x-referer': 'referer',
  'x-origin': 'origin',
  'x-user-agent': 'user-agent',
  'x-real-ip': 'x-real-ip',
};

const responseHeaderMap: Record<string, string> = {
  'set-cookie': 'x-set-cookie',
};

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  return handleProxy(request);
}

export async function POST(request: NextRequest) {
  return handleProxy(request);
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

async function handleProxy(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const destination = searchParams.get('destination');

  if (!destination) {
    return NextResponse.json({ error: 'Missing destination parameter' }, { status: 400 });
  }

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (headerMap[lowerKey]) {
      headers.set(headerMap[lowerKey], value);
    } else if (!lowerKey.startsWith('x-') && lowerKey !== 'host' && lowerKey !== 'connection') {
      headers.set(lowerKey, value);
    }
  });

  try {
    let body: any = undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    const response = await fetch(destination, {
      method: request.method,
      headers,
      body,
      redirect: 'manual', // Important to capture redirects
    });

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (responseHeaderMap[lowerKey]) {
        responseHeaders.set(responseHeaderMap[lowerKey], value);
      } else if (lowerKey !== 'content-encoding' && lowerKey !== 'content-length' && lowerKey !== 'transfer-encoding') {
        responseHeaders.set(lowerKey, value);
      }
    });

    // Handle redirects
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      responseHeaders.set('X-Final-Destination', response.headers.get('location')!);
    }

    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');
    responseHeaders.set('Access-Control-Expose-Headers', '*');

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error('Proxy error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
