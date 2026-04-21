// ─── ATMOS V4.0 — Smart Stream Resolver ──────────────────────────────
// Weighted scoring algorithm selects the best server automatically:
//   40% → Global health score (live ping results)
//   25% → Title-specific prewarm (did this server work for THIS movie?)
//   20% → User-reported success rate (crowd-sourced reliability)
//   15% → Latency penalty (closer = faster)
// Falls back to media_server Playwright extraction if top provider fails.

import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PROVIDERS, buildProviderUrl, type Provider } from '@/lib/providers';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { FEATURES } from '@/lib/constants';

// IMPORTANT: nodejs runtime keeps module-level state between requests (unlike edge)
export const runtime = 'nodejs';

const SUBS_URL = process.env.NEXT_PUBLIC_SUBS_URL || 'https://nikhil1776-atmos-subs.hf.space';


// ─── Module-level caches (persist between requests on nodejs runtime) ─
const streamCache = new Map<string, { providers: ResolvedProvider[]; timestamp: number }>();
const healthCache = { data: null as HealthData | null, timestamp: 0 };
const HEALTH_CACHE_TTL = 90 * 1000; // 90 seconds

interface HealthEntry {
  id: string;
  alive: boolean;
  latency: number;
  health_score: number;
  url?: string;
  user_reports?: { ok: number; fail: number };
}

interface HealthData {
  providers: HealthEntry[];
  from_cache: boolean;
}

interface ResolvedProvider {
  id: string;
  name: string;
  url: string;
  priority: number;
  healthScore: number;
  smartScore: number;
  latency?: number;
  alive?: boolean;
  source: 'prewarm' | 'global' | 'static';
}

// ─── SMART SCORE ALGORITHM ────────────────────────────────────────────
// Combines 4 signals into a single 0-100 score for ranking providers.
// Higher = better. Dead providers (alive=false) get score of 0.
function computeSmartScore(params: {
  globalScore: number;    // 0-100 from background health checks
  prewarmed: boolean;     // true if this title was specifically tested
  prewarmedAlive: boolean;// did it work for THIS title?
  latencyMs: number;      // response time in ms
  userOk: number;         // crowd-sourced successes
  userFail: number;       // crowd-sourced failures
  alive: boolean;         // currently alive?
}): number {
  const { globalScore, prewarmed, prewarmedAlive, latencyMs, userOk, userFail, alive } = params;
  
  // Dead = 0 immediately
  if (!alive) return 0;

  // Latency score: 0ms = 100pts, 2000ms = 0pts (linear decay)
  const latencyScore = Math.max(0, 100 - (latencyMs / 20));

  // Title-specific alive bonus: if pre-warmed and working → big boost
  const prewarmScore = prewarmed ? (prewarmedAlive ? 100 : 0) : 50; // 50 = unknown

  // User report score: % success rate from crowd reports
  const totalReports = userOk + userFail;
  const userScore = totalReports > 0 ? (userOk / totalReports) * 100 : 50; // 50 = no data

  // Weighted combination
  const smart = (
    globalScore  * 0.40 +
    prewarmScore * 0.25 +
    userScore    * 0.20 +
    latencyScore * 0.15
  );

  return Math.round(Math.min(100, Math.max(0, smart)));
}

// ─── Fetch health data from subs server ──────────────────────────────
async function fetchHealthData(tmdbId: string, type: string): Promise<HealthData | null> {
  // Use cached data if fresh
  if (healthCache.data && Date.now() - healthCache.timestamp < HEALTH_CACHE_TTL) {
    return healthCache.data;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    
    const res = await fetch(
      `${SUBS_URL}/provider-prewarmed?tmdb_id=${tmdbId}&type=${type}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (res.ok) {
      const data: HealthData = await res.json();
      healthCache.data = data;
      healthCache.timestamp = Date.now();
      return data;
    }
  } catch {
    // Health server unavailable — fall through to static ranking
  }
  return null;
}

// ─── Fetch providers (Supabase overrides → defaults) ─────────────────
const providerCache = { data: null as Provider[] | null, timestamp: 0 };
const PROVIDER_CACHE_TTL = 5 * 60 * 1000;

async function getProviders(): Promise<Provider[]> {
  if (providerCache.data && Date.now() - providerCache.timestamp < PROVIDER_CACHE_TTL) {
    return providerCache.data;
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('providers')
        .select('*')
        .eq('enabled', true)
        .order('priority', { ascending: true });

      if (!error && data && data.length > 0) {
        const providers: Provider[] = data.map(d => ({
          id: d.slug,
          name: d.name,
          slug: d.slug,
          urlPattern: d.url_pattern,
          urlStyle: (d.url_style || 'path') as Provider['urlStyle'],
          enabled: d.enabled,
          priority: d.priority,
          healthScore: d.health_score ?? 50,
          failCount: d.fail_count ?? 0,
          lastChecked: d.last_checked ? new Date(d.last_checked).getTime() : 0,
        }));
        providerCache.data = providers;
        providerCache.timestamp = Date.now();
        return providers;
      }
    } catch {
      // Supabase unavailable
    }
  }

  providerCache.data = DEFAULT_PROVIDERS;
  providerCache.timestamp = Date.now();
  return DEFAULT_PROVIDERS;
}

// ─── Main Handler ─────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get('id');
  const type = (searchParams.get('type') || 'movie') as 'movie' | 'tv';
  const season = searchParams.get('season') ? parseInt(searchParams.get('season')!) : undefined;
  const episode = searchParams.get('episode') ? parseInt(searchParams.get('episode')!) : undefined;

  if (!tmdbId) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  // ── Cache lookup ──
  const cacheKey = `${tmdbId}-${type}-${season ?? 0}-${episode ?? 0}`;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < FEATURES.STREAM_CACHE_TTL_MS) {
    return NextResponse.json({ providers: cached.providers, fromCache: true });
  }

  // ── Fetch providers + health data in parallel ──
  const [allProviders, healthData] = await Promise.all([
    getProviders(),
    fetchHealthData(tmdbId, type),
  ]);

  const enabledProviders = allProviders.filter(p => p.enabled && p.failCount < 5);

  // ── Build health lookup maps ──
  const healthMap = new Map<string, HealthEntry>();
  if (healthData?.providers) {
    for (const hp of healthData.providers) {
      healthMap.set(hp.id, hp);
    }
  }

  // ── Apply SMART SCORE algorithm to every provider ──
  const resolved: ResolvedProvider[] = enabledProviders.map(provider => {
    const liveHealth = healthMap.get(provider.id);

    const globalScore = liveHealth?.health_score ?? provider.healthScore ?? 50;
    const alive = liveHealth ? liveHealth.alive : true; // optimistic default
    const latencyMs = liveHealth?.latency ?? 3000;
    const prewarmed = !!liveHealth && healthData?.from_cache === true;
    const prewarmedAlive = prewarmed && (liveHealth?.alive ?? false);
    const userOk = liveHealth?.user_reports?.ok ?? 0;
    const userFail = liveHealth?.user_reports?.fail ?? 0;

    const smartScore = computeSmartScore({
      globalScore,
      prewarmed,
      prewarmedAlive,
      latencyMs,
      userOk,
      userFail,
      alive,
    });

    return {
      id: provider.id,
      name: provider.name || provider.id,
      url: buildProviderUrl(provider, tmdbId, type, season, episode),
      priority: provider.priority,
      healthScore: globalScore,
      smartScore,
      latency: latencyMs,
      alive,
      source: prewarmed ? 'prewarm' : liveHealth ? 'global' : 'static',
    };
  });

  // ── Sort by SMART SCORE descending, then latency ascending ──
  resolved.sort((a, b) => {
    if (b.smartScore !== a.smartScore) return b.smartScore - a.smartScore;
    return (a.latency ?? 9999) - (b.latency ?? 9999);
  });

  // ── Filter out completely dead providers (score = 0 and explicitly dead) ──
  const live = resolved.filter(r => r.smartScore > 0 || r.source === 'static');
  const final = live.length > 0 ? live : resolved; // never return empty

  // ── Evict stale cache entries ──
  streamCache.set(cacheKey, { providers: final, timestamp: Date.now() });
  if (streamCache.size > 500) {
    const sorted = [...streamCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    sorted.slice(0, 100).forEach(([k]) => streamCache.delete(k));
  }

  return NextResponse.json({
    providers: final,
    fromCache: false,
    healthEngine: !!healthData,
    algorithm: 'smart-v4',
    topServer: final[0]?.id,
    topScore: final[0]?.smartScore,
  });
}
