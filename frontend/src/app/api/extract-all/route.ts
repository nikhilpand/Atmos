// ─── ATMOS V5.0 — Nuclear Multi-Source Stream Extraction Engine ──────
// 12-source parallel extraction with intelligent fallback chains.
// Each scraper uses multiple strategies: JSON API → HTML regex → nested iframe resolution.

import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 45;

const PROXY_URL = process.env.NEXT_PUBLIC_CF_PROXY_URL || '';

interface ExtractedStream {
  url: string;
  quality: string;
  type: 'hls' | 'mp4' | 'unknown';
  provider: string;
  size?: string;
  captions: { language: string; url: string }[];
}

// ─── Helper: Proxy-aware fetch with timeout ─────────────────────────
async function pf(url: string, timeout = 8000, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const fetchUrl = PROXY_URL ? `${PROXY_URL}?destination=${encodeURIComponent(url)}` : url;
    return await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...headers,
      },
    });
  } finally { clearTimeout(timer); }
}

// ─── Helper: Extract all m3u8/mp4 URLs from text ────────────────────
function extractUrls(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  // Match HLS manifests
  for (const m of text.matchAll(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi)) {
    if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
  }
  // Match MP4 files
  for (const m of text.matchAll(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/gi)) {
    if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
  }
  return urls;
}

// ─── Helper: Resolve nested iframes (1 level deep) ─────────────────
async function resolveIframe(html: string, referer: string): Promise<string[]> {
  const iframeSrcs: string[] = [];
  for (const m of html.matchAll(/src=["']([^"']+)["']/gi)) {
    const src = m[1];
    if (src.startsWith('http') && !src.includes('cdnjs') && !src.includes('jquery') && !src.includes('cloudflare') && !src.includes('.js') && !src.includes('.css') && !src.includes('.svg') && !src.includes('.png')) {
      iframeSrcs.push(src);
    }
  }
  const allUrls: string[] = [];
  // Try fetching the first 3 iframe sources
  for (const src of iframeSrcs.slice(0, 3)) {
    try {
      const res = await pf(src, 6000, { 'Referer': referer });
      const text = await res.text();
      allUrls.push(...extractUrls(text));
      // Also look for base64-encoded data
      for (const b of text.matchAll(/atob\(["']([^"']+)["']\)/g)) {
        try {
          const decoded = Buffer.from(b[1], 'base64').toString();
          allUrls.push(...extractUrls(decoded));
          // Try parsing as JSON
          try {
            const json = JSON.parse(decoded);
            if (Array.isArray(json)) {
              for (const item of json) {
                if (item.file) allUrls.push(item.file);
                if (item.url) allUrls.push(item.url);
                if (item.src) allUrls.push(item.src);
              }
            }
          } catch { /* not JSON */ }
        } catch { /* not valid base64 */ }
      }
      // Look for JSON-encoded stream sources in script tags
      for (const j of text.matchAll(/sources\s*[:=]\s*(\[[\s\S]*?\])/g)) {
        try {
          const sources = JSON.parse(j[1]);
          for (const s of sources) {
            if (s.file) allUrls.push(s.file);
            if (s.src) allUrls.push(s.src);
            if (s.url) allUrls.push(s.url);
          }
        } catch { /* not valid JSON */ }
      }
    } catch { /* iframe fetch failed */ }
  }
  return allUrls;
}

// ─── Helper: Build streams from URL list ────────────────────────────
function buildStreams(urls: string[], provider: string): ExtractedStream[] {
  const seen = new Set<string>();
  return urls.filter(u => {
    if (seen.has(u)) return false;
    seen.add(u);
    return u.startsWith('http') && (u.includes('.m3u8') || u.includes('.mp4'));
  }).map(url => ({
    url,
    quality: 'auto',
    type: (url.includes('.m3u8') ? 'hls' : 'mp4') as 'hls' | 'mp4',
    provider,
    captions: [],
  }));
}

// ═══ SOURCE 1: VidSrc.icu (HTML scrape + nested iframe) ═══
async function s1(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' ? `/embed/movie/${tmdbId}` : `/embed/tv/${tmdbId}/${s}/${e}`;
    const res = await pf(`https://vidsrc.icu${path}`);
    const html = await res.text();
    let urls = extractUrls(html);
    if (urls.length === 0) urls = await resolveIframe(html, `https://vidsrc.icu${path}`);
    return buildStreams(urls, 'VidSrc.icu');
  } catch { return []; }
}

// ═══ SOURCE 2: Embed.su (base64 encoded streams) ═══
async function s2(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' ? `/embed/movie/${tmdbId}` : `/embed/tv/${tmdbId}/${s}/${e}`;
    const res = await pf(`https://embed.su${path}`);
    const html = await res.text();
    const urls: string[] = [];
    for (const b of html.matchAll(/atob\(["']([^"']+)["']\)/g)) {
      try {
        const decoded = Buffer.from(b[1], 'base64').toString();
        urls.push(...extractUrls(decoded));
        try {
          const json = JSON.parse(decoded);
          if (Array.isArray(json)) for (const item of json) { if (item.file) urls.push(item.file); }
        } catch { /* not json */ }
      } catch { /* decode failed */ }
    }
    urls.push(...extractUrls(html));
    if (urls.length === 0) urls.push(...await resolveIframe(html, `https://embed.su${path}`));
    return buildStreams(urls, 'Embed.su');
  } catch { return []; }
}

// ═══ SOURCE 3: VidSrc.cc ═══
async function s3(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' ? `/v2/embed/movie/${tmdbId}` : `/v2/embed/tv/${tmdbId}/${s}/${e}`;
    const res = await pf(`https://vidsrc.cc${path}`);
    const html = await res.text();
    let urls = extractUrls(html);
    if (urls.length === 0) urls = await resolveIframe(html, `https://vidsrc.cc${path}`);
    return buildStreams(urls, 'VidSrc.cc');
  } catch { return []; }
}

// ═══ SOURCE 4: AutoEmbed (JSON API) ═══
async function s4(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie'
      ? `/api/getVideoSource?type=movie&id=${tmdbId}`
      : `/api/getVideoSource?type=tv&id=${tmdbId}&season=${s}&episode=${e}`;
    const res = await pf(`https://autoembed.co${path}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.videoSource) {
      return [{
        url: data.videoSource,
        quality: 'auto',
        type: data.videoSource.includes('.m3u8') ? 'hls' : 'mp4',
        provider: 'AutoEmbed',
        captions: (data.subtitles || []).map((sub: { lang: string; url: string }) => ({ language: sub.lang, url: sub.url })),
      }];
    }
    return [];
  } catch { return []; }
}

// ═══ SOURCE 5: Videasy ═══
async function s5(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}/${s}/${e}`;
    const res = await pf(`https://player.videasy.net${path}`);
    const html = await res.text();
    let urls = extractUrls(html);
    if (urls.length === 0) urls = await resolveIframe(html, `https://player.videasy.net${path}`);
    return buildStreams(urls, 'Videasy');
  } catch { return []; }
}

// ═══ SOURCE 6: NonTongo ═══
async function s6(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' ? `/embed/movie/${tmdbId}` : `/embed/tv/${tmdbId}/${s}/${e}`;
    const res = await pf(`https://nontongo.win${path}`);
    const html = await res.text();
    let urls = extractUrls(html);
    if (urls.length === 0) urls = await resolveIframe(html, `https://nontongo.win${path}`);
    return buildStreams(urls, 'NonTongo');
  } catch { return []; }
}

// ═══ SOURCE 7: VidSrc.to (AJAX source resolver) ═══
async function s7(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' ? `/embed/movie/${tmdbId}` : `/embed/tv/${tmdbId}/${s}/${e}`;
    const res = await pf(`https://vidsrc.to${path}`);
    const html = await res.text();
    const streams: ExtractedStream[] = [];
    for (const m of html.matchAll(/data-id=["']([^"']+)["']/g)) {
      try {
        const ajaxRes = await pf(`https://vidsrc.to/ajax/embed/source/${m[1]}`, 5000);
        const data = await ajaxRes.json();
        if (data?.result?.url) {
          streams.push({
            url: data.result.url,
            quality: 'auto',
            type: data.result.url.includes('.m3u8') ? 'hls' : 'mp4',
            provider: 'VidSrc.to',
            captions: [],
          });
        }
      } catch { /* ajax failed */ }
    }
    return streams;
  } catch { return []; }
}

// ═══ SOURCE 8: @movie-web/providers ═══
async function s8(tmdbId: string, type: string, title: string, year: number, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const { makeProviders, makeSimpleProxyFetcher, makeStandardFetcher, targets } = await import('@movie-web/providers');
    const providers = makeProviders({
      fetcher: PROXY_URL ? makeSimpleProxyFetcher(PROXY_URL, fetch) : makeStandardFetcher(fetch),
      target: targets.NATIVE,
    });
    const media = type === 'movie'
      ? { type: 'movie' as const, title, releaseYear: year, tmdbId }
      : { type: 'show' as const, title, releaseYear: year, tmdbId, season: { number: s ?? 1, tmdbId: '' }, episode: { number: e ?? 1, tmdbId: '' } };
    const output = await providers.runAll({ media });
    if (!output?.stream) return [];
    const stream = Array.isArray(output.stream) ? output.stream[0] : output.stream;
    const results: ExtractedStream[] = [];
    const st = stream as { playlist?: string; url?: string; qualities?: Record<string, { url?: string }>; captions?: { language: string; url: string }[] };
    const captions = (st.captions || []).map(c => ({ language: c.language, url: c.url }));
    if (st.playlist) results.push({ url: st.playlist, quality: 'auto', type: 'hls', provider: `MW:${output.sourceId}`, captions });
    if (st.url) results.push({ url: st.url, quality: 'auto', type: st.url.includes('.m3u8') ? 'hls' : 'mp4', provider: `MW:${output.sourceId}`, captions });
    if (st.qualities) {
      for (const [q, data] of Object.entries(st.qualities)) {
        if (data?.url) results.push({ url: data.url, quality: q.includes('p') ? q : q + 'p', type: data.url.includes('.m3u8') ? 'hls' : 'mp4', provider: `MW:${output.sourceId}`, captions });
      }
    }
    return results;
  } catch { return []; }
}

// ═══ SOURCE 9: VidSrc.dev (fingerprint-gated API) ═══
async function s9(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' ? `/api/movie/${tmdbId}` : `/api/tv/${tmdbId}/${s}/${e}`;
    // First request gets a redirect with tr_uuid
    const res1 = await pf(`https://vidsrc.dev${path}`, 6000);
    const html1 = await res1.text();
    // Extract the redirect link
    const redirectMatch = html1.match(/redirect_link\s*=\s*['"]([^'"]+)['"]/);
    if (redirectMatch) {
      const redirectUrl = redirectMatch[1] + 'fp=-7';
      const res2 = await pf(redirectUrl, 6000, { 'Referer': 'https://vidsrc.dev/' });
      const html2 = await res2.text();
      let urls = extractUrls(html2);
      if (urls.length === 0) urls = await resolveIframe(html2, redirectUrl);
      return buildStreams(urls, 'VidSrc.dev');
    }
    return [];
  } catch { return []; }
}

// ═══ SOURCE 10: MultiEmbed ═══
async function s10(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    let url = `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`;
    if (type === 'tv' && s && e) url += `&s=${s}&e=${e}`;
    const res = await pf(url);
    const html = await res.text();
    let urls = extractUrls(html);
    if (urls.length === 0) urls = await resolveIframe(html, url);
    return buildStreams(urls, 'MultiEmbed');
  } catch { return []; }
}

// ═══ SOURCE 11: VidSrc.in ═══
async function s11(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' ? `/embed/movie/${tmdbId}` : `/embed/tv/${tmdbId}/${s}/${e}`;
    const res = await pf(`https://vidsrc.in${path}`);
    const html = await res.text();
    let urls = extractUrls(html);
    if (urls.length === 0) urls = await resolveIframe(html, `https://vidsrc.in${path}`);
    return buildStreams(urls, 'VidSrc.in');
  } catch { return []; }
}

// ═══ SOURCE 12: Smashy Stream ═══
async function s12(tmdbId: string, type: string, s?: number, e?: number): Promise<ExtractedStream[]> {
  try {
    const path = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}/${s}/${e}`;
    const res = await pf(`https://player.smashy.stream${path}`);
    const html = await res.text();
    let urls = extractUrls(html);
    if (urls.length === 0) urls = await resolveIframe(html, `https://player.smashy.stream${path}`);
    return buildStreams(urls, 'Smashy');
  } catch { return []; }
}

// ═══ MAIN HANDLER ═══
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tmdbId, type, title, releaseYear, season, episode } = body;
    if (!tmdbId || !type || !title) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    log.info('[ExtractAll] Starting 12-source extraction', { tmdbId, type, title, season, episode });

    const results = await Promise.allSettled([
      s8(tmdbId, type, title, releaseYear ?? new Date().getFullYear(), season, episode),
      s1(tmdbId, type, season, episode),
      s2(tmdbId, type, season, episode),
      s3(tmdbId, type, season, episode),
      s4(tmdbId, type, season, episode),
      s5(tmdbId, type, season, episode),
      s6(tmdbId, type, season, episode),
      s7(tmdbId, type, season, episode),
      s9(tmdbId, type, season, episode),
      s10(tmdbId, type, season, episode),
      s11(tmdbId, type, season, episode),
      s12(tmdbId, type, season, episode),
    ]);

    const allStreams: ExtractedStream[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const stream of result.value) {
          if (!seen.has(stream.url)) { seen.add(stream.url); allStreams.push(stream); }
        }
      }
    }

    // Sort: MP4 first, then HLS, then by quality
    const qOrder: Record<string, number> = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4, 'auto': 5 };
    allStreams.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'mp4' ? -1 : 1;
      return (qOrder[a.quality] ?? 99) - (qOrder[b.quality] ?? 99);
    });

    log.info('[ExtractAll] Complete', {
      tmdbId, streams: allStreams.length,
      sourcesChecked: results.length,
      sourcesFailed: results.filter(r => r.status === 'rejected').length,
      providers: [...new Set(allStreams.map(s => s.provider))],
    });

    return NextResponse.json({
      streams: allStreams,
      title, tmdbId, type,
      season: season ?? null, episode: episode ?? null,
      meta: { sourcesChecked: results.length, sourcesFailed: results.filter(r => r.status === 'rejected').length, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    log.error('[ExtractAll] Fatal', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ streams: [], error: 'Extraction failed' }, { status: 502 });
  }
}
