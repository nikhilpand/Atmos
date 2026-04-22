// ─── ATMOS V4.0 — Provider CRUD API ─────────────────────────────────
// Admin-only endpoints for managing streaming providers

import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { DEFAULT_PROVIDERS } from '@/lib/providers';

export const runtime = 'edge';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function checkAuth(request: NextRequest): boolean {
  const pwd = request.headers.get('x-admin-password') || '';
  return !!ADMIN_PASSWORD && pwd === ADMIN_PASSWORD;
}

// GET — List all providers
export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isSupabaseConfigured() && supabase) {
    const { data, error } = await supabase
      .from('providers')
      .select('*')
      .order('priority', { ascending: true });

    if (!error && data) {
      return NextResponse.json({ providers: data });
    }
  }

  // Return defaults if Supabase not configured
  return NextResponse.json({
    providers: DEFAULT_PROVIDERS.map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      url_pattern: p.urlPattern,
      enabled: p.enabled,
      priority: p.priority,
      health_score: p.healthScore,
      fail_count: p.failCount,
      last_checked: null,
    })),
  });
}

// POST — Add new provider
export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured() || !supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { name, slug, url_pattern, priority, enabled } = body;

    if (!name || !slug || !url_pattern) {
      return NextResponse.json({ error: 'name, slug, and url_pattern are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('providers')
      .insert({
        name,
        slug,
        url_pattern,
        priority: priority || 50,
        enabled: enabled !== false,
        health_score: 100,
        fail_count: 0,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ provider: data });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

// PUT — Update provider
export async function PUT(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured() || !supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('providers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ provider: data });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

// DELETE — Remove provider
export async function DELETE(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured() || !supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id parameter required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('providers')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
