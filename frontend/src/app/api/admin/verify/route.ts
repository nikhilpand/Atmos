// ─── ATMOS V4.0 — Admin Auth Verify ─────────────────────────────────
// Server-side password verification. The password never ships to the client.
// POST /api/admin/verify — { password } → { valid: boolean }

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    if (password === adminPassword) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ valid: false, error: 'Invalid password' }, { status: 401 });
  } catch {
    return NextResponse.json({ valid: false, error: 'Invalid request' }, { status: 400 });
  }
}
