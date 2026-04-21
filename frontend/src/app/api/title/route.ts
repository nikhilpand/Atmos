/* eslint-disable @typescript-eslint/no-explicit-any */
// ─── ATMOS V4.0 — Title Detail API ──────────────────────────────────
// Edge Runtime: fetches title detail via meta server /enrich endpoint
// Fallback chain: TMDB API → Meta /enrich → Meta /search
// Cached in-memory for 24 hours

import { NextRequest, NextResponse } from 'next/server';
import { META_URL } from '@/lib/constants';

export const runtime = 'edge';

const TMDB_API_KEY = process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';

// In-memory cache
const titleCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ─── TMDB Direct Fetch (if API key available) ──────────────────────
async function tmdbFetch(path: string): Promise<any> {
  if (!TMDB_API_KEY) return null;
  try {
    const url = `${TMDB_BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${TMDB_API_KEY}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return res.json();
  } catch { /* timeout or network error */ }
  return null;
}

// ─── Meta Server Enrich (primary fallback) ─────────────────────────
async function metaEnrich(title: string, type: string, year?: string): Promise<any> {
  try {
    const params = new URLSearchParams({ title, media_type: type });
    if (year) params.set('year', year);
    const res = await fetch(`${META_URL}/enrich?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      // If enrich returned an error object, it's not valid
      if (data.detail && Array.isArray(data.detail)) return null;
      return data;
    }
  } catch { /* timeout */ }
  return null;
}

// ─── Meta Server Search (last resort) ──────────────────────────────
async function metaSearch(query: string): Promise<any> {
  try {
    const res = await fetch(`${META_URL}/search?query=${encodeURIComponent(query)}&page=1`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.results?.[0] || null;
    }
  } catch { /* timeout */ }
  return null;
}

// ─── Build Full Title Response via TMDB ────────────────────────────
async function buildFromTMDB(id: string, type: string) {
  const [detail, credits, similar, videos] = await Promise.allSettled([
    tmdbFetch(`/${type}/${id}`),
    tmdbFetch(`/${type}/${id}/credits`),
    tmdbFetch(`/${type}/${id}/similar?page=1`),
    tmdbFetch(`/${type}/${id}/videos`),
  ]);

  const detailData = detail.status === 'fulfilled' ? detail.value : null;
  if (!detailData) return null;

  const creditsData = credits.status === 'fulfilled' ? credits.value : null;
  const similarData = similar.status === 'fulfilled' ? similar.value : null;
  const videosData = videos.status === 'fulfilled' ? videos.value : null;

  // For TV: extract season list
  let seasons = null;
  if (type === 'tv' && detailData.seasons) {
    seasons = detailData.seasons
      .map((s: any) => ({
        id: s.id,
        season_number: s.season_number,
        name: s.name,
        episode_count: s.episode_count,
        poster_path: s.poster_path,
        overview: s.overview,
        air_date: s.air_date,
      }));
  }

  return {
    detail: {
      id: detailData.id,
      title: detailData.title || detailData.name,
      name: detailData.name,
      overview: detailData.overview,
      poster_path: detailData.poster_path,
      backdrop_path: detailData.backdrop_path,
      vote_average: detailData.vote_average,
      release_date: detailData.release_date || detailData.first_air_date,
      first_air_date: detailData.first_air_date,
      runtime: detailData.runtime || detailData.episode_run_time?.[0],
      genres: detailData.genres,
      tagline: detailData.tagline,
      status: detailData.status,
      number_of_seasons: detailData.number_of_seasons,
      number_of_episodes: detailData.number_of_episodes,
      media_type: type,
    },
    cast: (creditsData?.cast || []).slice(0, 20).map((c: any) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      profile_path: c.profile_path,
      order: c.order,
    })),
    similar: (similarData?.results || []).slice(0, 12).map((s: any) => ({
      id: s.id,
      title: s.title || s.name,
      poster_path: s.poster_path,
      vote_average: s.vote_average,
      media_type: type,
      release_date: s.release_date || s.first_air_date,
    })),
    videos: (videosData?.results || [])
      .filter((v: any) => v.site === 'YouTube')
      .slice(0, 5)
      .map((v: any) => ({
        key: v.key,
        name: v.name,
        type: v.type,
        site: v.site,
      })),
    seasons,
  };
}

// ─── Build Title Response from Meta /enrich ─────────────────────────
function buildFromEnrich(enriched: any, tmdbId: string, type: string) {
  return {
    detail: {
      id: enriched.tmdb_id || parseInt(tmdbId),
      title: enriched.title || enriched.original_title,
      name: enriched.title,
      overview: enriched.overview || '',
      poster_path: enriched.poster_path || null,
      backdrop_path: enriched.backdrop_path || null,
      vote_average: enriched.rating || enriched.vote_average || 0,
      release_date: enriched.year ? `${enriched.year}-01-01` : null,
      first_air_date: enriched.year ? `${enriched.year}-01-01` : null,
      runtime: enriched.runtime || null,
      genres: (enriched.genres || []).map((g: string, i: number) => ({
        id: i,
        name: g,
      })),
      tagline: enriched.tagline || null,
      status: null,
      number_of_seasons: enriched.number_of_seasons || null,
      number_of_episodes: null,
      media_type: type,
    },
    cast: (enriched.cast || []).slice(0, 20).map((c: any, i: number) => ({
      id: i,
      name: c.name,
      character: c.character || c.role || '',
      profile_path: c.profile
        ? c.profile.replace('https://image.tmdb.org/t/p/w185', '')
        : null,
      order: i,
    })),
    similar: [],
    videos: (enriched.videos || enriched.trailers || [])
      .slice(0, 5)
      .map((v: any) => ({
        key: v.key || v.id,
        name: v.name || 'Trailer',
        type: v.type || 'Trailer',
        site: 'YouTube',
      })),
    seasons: enriched.seasons || (enriched.number_of_seasons
      ? Array.from({ length: enriched.number_of_seasons }, (_, i) => ({
          id: i + 1, season_number: i + 1, name: `Season ${i + 1}`,
          episode_count: 10, poster_path: null, overview: null, air_date: null,
        }))
      : type === 'tv' 
        ? [{
            id: 1, season_number: 1, name: 'Season 1',
            episode_count: 10, poster_path: null, overview: null, air_date: null,
          }]
        : null),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const type = searchParams.get('type') || 'movie';
  const title = searchParams.get('title'); // Optional: title for enrich fallback

  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  // ── Season Episode Detail Mode ──
  const seasonNum = searchParams.get('season');
  if (seasonNum && type === 'tv') {
    const episodeCacheKey = `${type}-${id}-s${seasonNum}`;
    const cachedEp = titleCache.get(episodeCacheKey);
    if (cachedEp && Date.now() - cachedEp.timestamp < CACHE_TTL) {
      return NextResponse.json(cachedEp.data);
    }

    const seasonData = await tmdbFetch(`/tv/${id}/season/${seasonNum}`);
    if (seasonData?.episodes) {
      const episodes = seasonData.episodes.map((ep: any) => ({
        id: ep.id,
        episode_number: ep.episode_number,
        season_number: ep.season_number,
        name: ep.name,
        overview: ep.overview || '',
        still_path: ep.still_path,
        air_date: ep.air_date,
        runtime: ep.runtime,
        vote_average: ep.vote_average,
      }));
      const result = { episodes };
      titleCache.set(episodeCacheKey, { data: result, timestamp: Date.now() });
      return NextResponse.json(result);
    }
    // Fallback: generate placeholder episodes
    return NextResponse.json({ episodes: [] });
  }

  // Check cache
  const cacheKey = `${type}-${id}`;
  const cached = titleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    // ── Strategy 1: Direct TMDB API (if key available) ──
    const tmdbResult = await buildFromTMDB(id, type);
    if (tmdbResult) {
      titleCache.set(cacheKey, { data: tmdbResult, timestamp: Date.now() });
      evictCache();
      return NextResponse.json(tmdbResult);
    }

    // ── Strategy 2: Meta /enrich with title ──
    let titleName = title;
    
    // Strategy 2a: If no title provided, try to find it from trending data
    if (!titleName) {
      try {
        // Scan trending results to find this TMDB ID
        const trendRes = await fetch(`${META_URL}/trending?page=1&media_type=all&time_window=week`, {
          signal: AbortSignal.timeout(5000),
        });
        if (trendRes.ok) {
          const trendData = await trendRes.json();
          const match = (trendData.results || []).find(
            (r: any) => String(r.tmdb_id) === id
          );
          if (match) {
            titleName = match.title || match.name;
          }
        }
      } catch { /* timeout */ }
    }

    // Strategy 2b: Try meta /search with the TMDB ID as query (last resort for name lookup)
    if (!titleName) {
      const searchResult = await metaSearch(id);
      if (searchResult) {
        titleName = searchResult.title || searchResult.name;
      }
    }

    // Strategy 2c: If we have a title, enrich it
    if (titleName) {
      const enriched = await metaEnrich(titleName, type);
      if (enriched && enriched.tmdb_id) {
        const result = buildFromEnrich(enriched, id, type);
        titleCache.set(cacheKey, { data: result, timestamp: Date.now() });
        evictCache();
        return NextResponse.json(result);
      }
    }

    // ── Strategy 3: Return minimal data ──
    // For TV, try one last TMDB fetch just for seasons
    let fallbackSeasons = null;
    if (type === 'tv') {
      const tvDetail = await tmdbFetch(`/tv/${id}`);
      if (tvDetail?.seasons) {
        fallbackSeasons = tvDetail.seasons
          .map((s: any) => ({
            id: s.id, season_number: s.season_number, name: s.name,
            episode_count: s.episode_count, poster_path: s.poster_path,
            overview: s.overview, air_date: s.air_date,
          }));
      }
      if (!fallbackSeasons || fallbackSeasons.length === 0) {
        fallbackSeasons = [{ id: 1, season_number: 1, name: 'Season 1', episode_count: 10, poster_path: null, overview: null, air_date: null }];
      }
    }
    return NextResponse.json({
      detail: {
        id: parseInt(id) || 0,
        title: titleName || 'Unknown Title',
        name: titleName || 'Unknown Title',
        overview: '',
        poster_path: null,
        backdrop_path: null,
        vote_average: 0,
        release_date: null,
        runtime: null,
        genres: [],
        tagline: null,
        status: null,
        number_of_seasons: fallbackSeasons?.length || null,
        number_of_episodes: null,
        media_type: type,
      },
      cast: [],
      similar: [],
      videos: [],
      seasons: fallbackSeasons,
    });
  } catch {
    return NextResponse.json({
      error: 'Failed to fetch title details',
      detail: { id: parseInt(id) || 0, title: 'Error', name: 'Error', overview: '', poster_path: null, backdrop_path: null, vote_average: 0, genres: [], media_type: type },
      cast: [],
      similar: [],
      videos: [],
      seasons: null,
    }, { status: 200 }); // Return 200 with partial data to prevent client crash
  }
}

function evictCache() {
  if (titleCache.size > 200) {
    const oldest = [...titleCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, titleCache.size - 150);
    for (const [key] of oldest) {
      titleCache.delete(key);
    }
  }
}
