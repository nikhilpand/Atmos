// ─── ATMOS V4.0 — User Auth API ──────────────────────────────────────
// Simple localStorage-based auth with optional Supabase upgrade path
// POST /api/auth — Login/Register
// DELETE /api/auth — Logout (client-side only)

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

// Uses Supabase for Auth. Maps username to a pseudo-email for Supabase compatibility.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password required' },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 20) {
      return NextResponse.json(
        { error: 'Username must be 3-20 characters' },
        { status: 400 }
      );
    }

    if (password.length < 4) {
      return NextResponse.json(
        { error: 'Password must be at least 4 characters' },
        { status: 400 }
      );
    }

    // Fallback if Supabase is not configured locally
    if (!supabase) {
      const sessionToken = btoa(`${username}:${Date.now()}`);
      return NextResponse.json({
        success: true,
        user: {
          username,
          createdAt: new Date().toISOString(),
        },
        token: sessionToken,
        warning: 'Supabase not configured, using local mock auth',
      });
    }

    // Map username to a pseudo-email for Supabase Auth
    const email = `${username.toLowerCase()}@atmos.internal`;

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    let finalUser = signInData?.user;
    let finalSession = signInData?.session;
    let finalError = signInError;

    // If invalid credentials, attempt to register
    if (signInError && signInError.message.includes('Invalid login credentials')) {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } }
      });
      finalUser = signUpData?.user || null;
      finalSession = signUpData?.session || null;
      finalError = signUpError;
    }

    if (finalError) {
      return NextResponse.json({ error: finalError.message }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: finalUser?.id,
        username: finalUser?.user_metadata?.username || username,
        createdAt: finalUser?.created_at,
      },
      token: finalSession?.access_token,
    });
  } catch (error) {
    console.error('Auth endpoint error:', error);
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'ATMOS Auth API',
    endpoints: {
      'POST /api/auth': 'Login or register with { username, password }',
    },
  });
}
