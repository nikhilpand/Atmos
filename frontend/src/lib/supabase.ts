// ─── ATMOS V4.0 — Supabase Client ───────────────────────────────────
// Initialize Supabase client for user auth, watchlist, and provider storage
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Client-side Supabase instance (uses anon key)
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey && supabase);
}

// ─── Database Types ─────────────────────────────────────────────────
export interface DbUser {
  id: string;
  username: string;
  created_at: string;
}

export interface DbWatchlistItem {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: string;
  title: string;
  poster_path: string | null;
  added_at: string;
}

export interface DbProvider {
  id: string;
  name: string;
  slug: string;
  url_pattern: string;
  url_style: string;
  enabled: boolean;
  priority: number;
  health_score: number;
  fail_count: number;
  last_checked: string | null;
  created_at: string;
}
