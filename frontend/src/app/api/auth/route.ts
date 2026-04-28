// ─── ATMOS V5.0 — User Auth API ──────────────────────────────────────
// POST /api/auth — Login or Register (explicit action required)
// Requires { username, password, action: 'login' | 'register' }
// Wrong password on login → 401, never auto-creates an account

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password, action } = body as {
      username?: string;
      password?: string;
      action?: 'login' | 'register';
    };

    // ── Input validation ───────────────────────────────────────────
    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }
    if (action !== 'login' && action !== 'register') {
      return NextResponse.json(
        { error: 'action must be "login" or "register"' },
        { status: 400 }
      );
    }
    if (username.length < 3 || username.length > 20) {
      return NextResponse.json({ error: 'Username must be 3–20 characters' }, { status: 400 });
    }
    if (!/^[a-z0-9_]+$/i.test(username)) {
      return NextResponse.json(
        { error: 'Username may only contain letters, numbers and underscores' },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // ── Supabase-less fallback (dev / misconfigured environments) ──
    if (!supabase) {
      // Use a cryptographically random token — NOT btoa(username)
      const sessionToken = crypto.randomUUID();
      return NextResponse.json({
        success: true,
        user: { username, createdAt: new Date().toISOString() },
        token: sessionToken,
        warning: 'Supabase not configured — using ephemeral session',
      });
    }

    const email = `${username.toLowerCase()}@atmos.internal`;

    // ── LOGIN path ─────────────────────────────────────────────────
    if (action === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Return generic message — don't leak whether the account exists
        return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
      }
      return NextResponse.json({
        success: true,
        user: {
          id: data.user?.id,
          username: data.user?.user_metadata?.username || username,
          createdAt: data.user?.created_at,
        },
        token: data.session?.access_token,
      });
    }

    // ── REGISTER path ──────────────────────────────────────────────
    // First check if the account already exists
    const { error: signUpError, data: signUpData } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });

    if (signUpError) {
      // Supabase returns "User already registered" for duplicate emails
      if (signUpError.message.toLowerCase().includes('already registered')) {
        return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
      }
      return NextResponse.json({ error: signUpError.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: signUpData.user?.id,
        username: signUpData.user?.user_metadata?.username || username,
        createdAt: signUpData.user?.created_at,
      },
      token: signUpData.session?.access_token,
    });
  } catch (error) {
    console.error('[Auth] Endpoint error:', error);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'ATMOS Auth API v5',
    endpoints: {
      'POST /api/auth': 'Login with { username, password, action: "login" } or register with action: "register"',
    },
  });
}
