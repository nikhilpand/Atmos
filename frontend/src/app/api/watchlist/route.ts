// ─── ATMOS V4.0 — Watchlist API ─────────────────────────────────────
// GET /api/watchlist — Get user's watchlist  
// POST /api/watchlist — Add item
// DELETE /api/watchlist — Remove item
// Currently backed by client-side localStorage (Zustand persist)
// Upgrade to Supabase for cloud sync when DB is configured

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'edge';

// GET /api/watchlist?userId=...
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (!supabase) {
      return NextResponse.json({ items: [], source: 'local', warning: 'Supabase not configured' });
    }

    const { data, error } = await supabase
      .from('watchlist')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      source: 'supabase',
      items: data || [],
    });
  } catch (error) {
    console.error('Watchlist GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 });
  }
}

// POST /api/watchlist
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, tmdbId, type, title, posterPath } = body;

    if (!userId || !tmdbId || !type || !title) {
      return NextResponse.json(
        { error: 'userId, tmdbId, type, and title are required' },
        { status: 400 }
      );
    }

    if (!supabase) {
      return NextResponse.json({
        success: true,
        item: { tmdbId, type, title, posterPath, addedAt: new Date().toISOString() },
        warning: 'Supabase not configured'
      });
    }

    const { data, error } = await supabase
      .from('watchlist')
      .insert({
        user_id: userId,
        tmdb_id: tmdbId,
        media_type: type,
        title,
        poster_path: posterPath,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      item: data,
    });
  } catch (error) {
    console.error('Watchlist POST error:', error);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

// DELETE /api/watchlist?userId=...&tmdbId=...
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const tmdbId = searchParams.get('tmdbId');

    if (!userId || !tmdbId) {
      return NextResponse.json(
        { error: 'userId and tmdbId are required' },
        { status: 400 }
      );
    }

    if (!supabase) {
      return NextResponse.json({ success: true, removed: tmdbId, warning: 'Supabase not configured' });
    }

    const { error } = await supabase
      .from('watchlist')
      .delete()
      .eq('user_id', userId)
      .eq('tmdb_id', tmdbId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      removed: tmdbId,
    });
  } catch (error) {
    console.error('Watchlist DELETE error:', error);
    return NextResponse.json({ error: 'Failed to remove item' }, { status: 400 });
  }
}
