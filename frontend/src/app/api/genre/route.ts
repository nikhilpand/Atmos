/* eslint-disable @typescript-eslint/no-explicit-any */
// ─── ATMOS V4.0 — Genre Discovery API ───────────────────────────────
// Edge Runtime: fetches TMDB discover with genre filtering

import { NextRequest, NextResponse } from 'next/server';
import { META_URL } from '@/lib/constants';

export const runtime = 'edge';

const TMDB_API_KEY = process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY || '';
const TMDB_BASE = 'https://api.themoviedb.org/3';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const genreId = searchParams.get('genre_id');
  const type = searchParams.get('type') || 'movie';
  const page = searchParams.get('page') || '1';

  if (!genreId) {
    return NextResponse.json({ error: 'Missing genre_id parameter' }, { status: 400 });
  }

  try {
    let data: any = null;

    // Try direct TMDB API
    if (TMDB_API_KEY) {
      const res = await fetch(
        `${TMDB_BASE}/discover/${type}?api_key=${TMDB_API_KEY}&with_genres=${genreId}&page=${page}&sort_by=popularity.desc&vote_count.gte=50`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (res.ok) {
        data = await res.json();
      }
    }

    // Fallback: use meta server trending with filtering
    if (!data) {
      const res = await fetch(
        `${META_URL}/trending?page=${page}&media_type=${type === 'tv' ? 'tv' : 'movie'}&time_window=week`
      );
      if (res.ok) {
        const raw = await res.json();
        // Client-side genre filter since meta server doesn't support genre filtering
        const filtered = (raw.results || []).filter((item: any) =>
          item.genre_ids?.includes(parseInt(genreId))
        );
        data = {
          results: filtered,
          page: raw.page,
          total_pages: raw.total_pages,
        };
      }
    }

    if (!data) {
      return NextResponse.json({ results: [], page: 1, totalPages: 1 });
    }

    // Normalize items
    const results = (data.results || []).map((item: any) => ({
      id: item.id,
      title: item.title || item.name,
      overview: item.overview,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      vote_average: item.vote_average,
      release_date: item.release_date || item.first_air_date,
      media_type: type,
      genre_ids: item.genre_ids,
    }));

    return NextResponse.json({
      results,
      page: data.page || parseInt(page),
      totalPages: data.total_pages || 1,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch genre content' }, { status: 500 });
  }
}
