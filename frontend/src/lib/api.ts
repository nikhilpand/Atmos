// ─── ATMOS V4.0 — Centralized API Client ────────────────────────────
// All backend calls go through this layer for consistency, caching, and retry

import { META_URL, TMDB_IMAGE_BASE, TMDB_POSTER_SIZES, TMDB_BACKDROP_SIZES } from './constants';

// ─── Types ──────────────────────────────────────────────────────────
export interface TMDBItem {
  id: number;
  tmdb_id?: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  media_type?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  popularity?: number;
}

export interface TMDBDetail extends TMDBItem {
  runtime?: number;
  number_of_seasons?: number;
  number_of_episodes?: number;
  genres?: { id: number; name: string }[];
  tagline?: string;
  status?: string;
  homepage?: string;
  production_companies?: { id: number; name: string; logo_path?: string }[];
  spoken_languages?: { english_name: string; iso_639_1: string; name: string }[];
  origin_country?: string[];
}

export interface CastMember {
  id: number;
  name: string;
  character?: string;
  profile_path?: string;
  order?: number;
}

export interface Season {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
  poster_path?: string;
  overview?: string;
  air_date?: string;
}

export interface Episode {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview?: string;
  still_path?: string;
  air_date?: string;
  runtime?: number;
  vote_average?: number;
}

export interface TitleDetail {
  detail: TMDBDetail;
  cast: CastMember[];
  similar: TMDBItem[];
  videos: { key: string; name: string; type: string; site: string }[];
  seasons?: Season[];
}

export interface ResolvedStream {
  providers: { id: string; name: string; url: string; priority: number }[];
  fromCache: boolean;
}

// ─── Image URL helpers ──────────────────────────────────────────────
export function posterUrl(path: string | null | undefined, size: keyof typeof TMDB_POSTER_SIZES = 'large'): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}/${TMDB_POSTER_SIZES[size]}${path}`;
}

export function backdropUrl(path: string | null | undefined, size: keyof typeof TMDB_BACKDROP_SIZES = 'large'): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}/${TMDB_BACKDROP_SIZES[size]}${path}`;
}

// ─── Fetch with retry ───────────────────────────────────────────────
async function fetchWithRetry(url: string, options?: RequestInit, retries = 1): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...options, next: { revalidate: 300 } });
      if (res.ok) return res;
      if (i === retries) return res;
    } catch (err) {
      if (i === retries) throw err;
    }
  }
  throw new Error('Fetch failed');
}

// ─── Trending Content ───────────────────────────────────────────────
export async function fetchTrending(
  page = 1,
  mediaType: 'all' | 'movie' | 'tv' = 'all',
  timeWindow: 'day' | 'week' = 'week'
): Promise<{ results: TMDBItem[]; page: number; totalPages: number }> {
  const res = await fetchWithRetry(
    `${META_URL}/trending?page=${page}&media_type=${mediaType}&time_window=${timeWindow}`
  );
  const data = await res.json();
  return {
    results: data.results || [],
    page: data.page || page,
    totalPages: data.total_pages || 1,
  };
}

// ─── Search ─────────────────────────────────────────────────────────
export async function searchContent(
  query: string,
  page = 1
): Promise<{ results: TMDBItem[]; page: number; totalPages: number }> {
  const res = await fetchWithRetry(
    `${META_URL}/search?query=${encodeURIComponent(query)}&page=${page}`
  );
  const data = await res.json();
  return {
    results: data.results || [],
    page: data.page || page,
    totalPages: data.total_pages || 1,
  };
}

// ─── Title Detail ───────────────────────────────────────────────────
export async function fetchTitle(
  id: string | number,
  type: 'movie' | 'tv',
  title?: string
): Promise<TitleDetail> {
  const params = new URLSearchParams({ id: String(id), type });
  if (title) params.set('title', title);
  const res = await fetchWithRetry(`/api/title?${params}`);
  return res.json();
}

// ─── Genre Discovery ────────────────────────────────────────────────
export async function fetchGenreContent(
  genreId: number,
  type: 'movie' | 'tv' = 'movie',
  page = 1
): Promise<{ results: TMDBItem[]; page: number; totalPages: number }> {
  const res = await fetchWithRetry(
    `/api/genre?genre_id=${genreId}&type=${type}&page=${page}`
  );
  return res.json();
}

// ─── Stream Resolution ─────────────────────────────────────────────
export async function resolveStream(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ResolvedStream> {
  const params = new URLSearchParams({ id: tmdbId, type });
  if (season) params.set('season', String(season));
  if (episode) params.set('episode', String(episode));
  
  const res = await fetchWithRetry(`/api/resolve?${params}`);
  return res.json();
}

// ─── Home Row Fetch (via meta server) ───────────────────────────────
export async function fetchHomeRow(
  endpoint: string,
  params?: Record<string, string>,
  page = 1
): Promise<{ results: TMDBItem[]; page: number; totalPages: number }> {
  // Use meta server for trending endpoints, API route for discover
  if (endpoint.startsWith('trending/') || endpoint.includes('/popular') || endpoint.includes('/top_rated') || endpoint.includes('/now_playing')) {
    // These are handled by the meta server
    const parts = endpoint.split('/');
    const mediaType = parts[0] === 'trending' ? parts[1] : parts[0];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const variant = parts[0] === 'trending' ? 'trending' : parts[1];
    
    let url: string;
    if (endpoint.startsWith('trending/')) {
      url = `${META_URL}/trending?page=${page}&media_type=${mediaType}&time_window=${parts[2] || 'week'}`;
    } else {
      // popular, top_rated, now_playing — use trending endpoint with filters
      url = `${META_URL}/trending?page=${page}&media_type=${mediaType}&time_window=week`;
    }
    
    const res = await fetchWithRetry(url);
    const data = await res.json();
    return {
      results: data.results || [],
      page: data.page || page,
      totalPages: data.total_pages || 1,
    };
  }
  
  // Discover endpoints — go through our API route
  if (endpoint.startsWith('discover/')) {
    const type = endpoint.includes('/movie') ? 'movie' : 'tv';
    const genreId = params?.with_genres || '';
    const res = await fetchWithRetry(`/api/genre?genre_id=${genreId}&type=${type}&page=${page}`);
    return res.json();
  }

  // Fallback
  return { results: [], page: 1, totalPages: 1 };
}
