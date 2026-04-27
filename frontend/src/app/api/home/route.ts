// ═══════════════════════════════════════════════════════════════════════
// ATMOS — /api/home — Server-side batch home page data
// ═══════════════════════════════════════════════════════════════════════
// Fetches ALL home page data in ONE request, deduplicated server-side.
// Frontend makes 1 call instead of 8+.
// Cache: 60s (s-maxage) at CDN edge.
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const TMDB_KEY = process.env.TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';

// Fetch with 5s timeout
async function tmdbFetch(path: string): Promise<any> {
  const url = `${TMDB_BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}&language=en-US`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, next: { revalidate: 60 } });
    clearTimeout(t);
    return res.ok ? res.json() : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

function dedup<T extends { id: number }>(items: T[], seen: Set<number>): T[] {
  return items.filter(i => {
    if (!i?.id || seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

export async function GET() {
  if (!TMDB_KEY) {
    return NextResponse.json({ error: 'TMDB key not configured' }, { status: 500 });
  }

  // Fetch all sections in parallel
  const [
    trendingDay,
    trendingWeek,
    popularMovies,
    topRatedTV,
    nowPlaying,
    upcoming,
    actionMovies,
    animeTV,
    thrillerMovies,
    scifiMovies,
  ] = await Promise.all([
    tmdbFetch('/trending/all/day?page=1'),
    tmdbFetch('/trending/all/week?page=1'),
    tmdbFetch('/movie/popular?page=1'),
    tmdbFetch('/tv/top_rated?page=1'),
    tmdbFetch('/movie/now_playing?page=1'),
    tmdbFetch('/movie/upcoming?page=1'),
    tmdbFetch('/discover/movie?with_genres=28&sort_by=popularity.desc'),
    tmdbFetch('/discover/tv?with_genres=16&sort_by=popularity.desc'),
    tmdbFetch('/discover/movie?with_genres=53&sort_by=popularity.desc'),
    tmdbFetch('/discover/movie?with_genres=878&sort_by=popularity.desc'),
  ]);

  const seen = new Set<number>();

  // Hero: top 5 trending/day with backdrop
  const hero = dedup(
    (trendingDay?.results || []).filter((i: any) => i.backdrop_path && i.poster_path),
    seen,
  ).slice(0, 5);

  // Top 10: trending/day with poster (after hero consumed some)
  const top10 = dedup(
    (trendingDay?.results || []).filter((i: any) => i.poster_path),
    seen,
  ).slice(0, 10);

  // Content rows — each deduped against all previous
  const rows = [
    {
      id: 'popular_movies',
      title: 'Popular Movies',
      items: dedup((popularMovies?.results || []).filter((i: any) => i.poster_path), seen).slice(0, 20),
    },
    {
      id: 'top_rated_tv',
      title: 'Top Rated TV',
      items: dedup((topRatedTV?.results || []).filter((i: any) => i.poster_path), seen).slice(0, 20),
    },
    {
      id: 'trending_week',
      title: 'Trending This Week',
      items: dedup((trendingWeek?.results || []).filter((i: any) => i.poster_path), seen).slice(0, 20),
    },
    {
      id: 'now_playing',
      title: 'In Cinemas Now',
      items: dedup((nowPlaying?.results || []).filter((i: any) => i.poster_path), seen).slice(0, 20),
    },
    {
      id: 'upcoming',
      title: 'Coming Soon',
      items: dedup((upcoming?.results || []).filter((i: any) => i.poster_path), seen).slice(0, 20),
    },
    {
      id: 'action',
      title: 'Action Movies',
      items: dedup((actionMovies?.results || []).filter((i: any) => i.poster_path), seen).slice(0, 20),
    },
    {
      id: 'anime',
      title: 'Anime',
      items: dedup((animeTV?.results || []).filter((i: any) => i.poster_path), seen).slice(0, 20),
    },
    {
      id: 'thriller',
      title: 'Thrillers',
      items: dedup((thrillerMovies?.results || []).filter((i: any) => i.poster_path), seen).slice(0, 20),
    },
    {
      id: 'scifi',
      title: 'Sci-Fi',
      items: dedup((scifiMovies?.results || []).filter((i: any) => i.poster_path), seen).slice(0, 20),
    },
  ].filter(row => row.items.length > 0);

  return NextResponse.json(
    { hero, top10, rows },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
