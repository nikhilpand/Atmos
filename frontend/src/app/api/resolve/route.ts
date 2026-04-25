// ═══════════════════════════════════════════════════════════════════════
// ATMOS V5.0 — Content-Aware Smart Stream Resolver
// ═══════════════════════════════════════════════════════════════════════
// Ultra algorithm engine with 5-signal weighted scoring:
//   30% → Global health score (live ping results)
//   25% → Content affinity (anime → anime-best providers, etc.)
//   20% → Title-specific prewarm (did this server work for THIS title?)
//   15% → User-reported success rate (crowd-sourced reliability)
//   10% → Latency penalty (closer = faster)
//
// Content classification uses TMDB metadata to detect:
//   anime, bollywood, korean, netflix, hbo, disney, amazon, apple,
//   hotstar, paramount, turkish, chinese, hollywood, general
// ═══════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PROVIDERS, buildProviderUrl, type Provider } from '@/lib/providers';
import { classifyContent, getProviderBoost, type ContentCategory, type ClassifierInput } from '@/lib/contentClassifier';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { FEATURES, TMDB_BASE, TMDB_API_KEY } from '@/lib/constants';

export const runtime = 'nodejs';

const SUBS_URL = process.env.NEXT_PUBLIC_SUBS_URL || 'https://nikhil1776-atmos-subs.hf.space';
const TMDB_KEY = TMDB_API_KEY || process.env.TMDB_API_KEY || '';

// ─── Module-level caches ─────────────────────────────────────────────
const streamCache = new Map<string, { providers: ResolvedProvider[]; category: ContentCategory; timestamp: number }>();
const healthCache = { data: null as HealthData | null, timestamp: 0 };
const tmdbCache = new Map<string, { data: ClassifierInput; timestamp: number }>();
const HEALTH_CACHE_TTL = 120_000;
const TMDB_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

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
  affinityBoost: number;
  latency?: number;
  alive?: boolean;
  source: 'prewarm' | 'global' | 'static';
}

// ═══════════════════════════════════════════════════════════════════════
// SMART SCORE V5 — Content-Aware Algorithm
// ═══════════════════════════════════════════════════════════════════════
function computeSmartScore(params: {
  globalScore: number;
  affinityBoost: number;  // NEW: from content classifier
  prewarmed: boolean;
  prewarmedAlive: boolean;
  latencyMs: number;
  userOk: number;
  userFail: number;
  alive: boolean;
}): number {
  const { globalScore, affinityBoost, prewarmed, prewarmedAlive, latencyMs, userOk, userFail, alive } = params;

  if (!alive) return 0;

  // Latency score: 0ms = 100pts, 2000ms = 0pts
  const latencyScore = Math.max(0, 100 - (latencyMs / 20));

  // Prewarm score
  const prewarmScore = prewarmed ? (prewarmedAlive ? 100 : 0) : 50;

  // User report score
  const totalReports = userOk + userFail;
  const userScore = totalReports > 0 ? (userOk / totalReports) * 100 : 50;

  // Content affinity score: normalize boost (-15 to +25) → 0 to 100
  const affinityScore = Math.max(0, Math.min(100, 50 + (affinityBoost * 2)));

  // V5 weighted combination
  const smart = (
    globalScore    * 0.30 +  // Health
    affinityScore  * 0.25 +  // Content affinity (NEW)
    prewarmScore   * 0.20 +  // Title-specific
    userScore      * 0.15 +  // Crowd-sourced
    latencyScore   * 0.10    // Speed
  );

  return Math.round(Math.min(100, Math.max(0, smart)));
}

// ─── Fetch TMDB metadata for classification ──────────────────────────
async function fetchTMDBForClassification(tmdbId: string, type: string): Promise<ClassifierInput | null> {
  const cacheKey = `${tmdbId}:${type}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TMDB_CACHE_TTL) {
    return cached.data;
  }

  if (!TMDB_KEY) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500); // 1.5s timeout — fast

    const url = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const classifierInput: ClassifierInput = {
        genre_ids: data.genre_ids,
        genres: data.genres,
        origin_country: data.origin_country || data.production_countries?.map((c: { iso_3166_1: string }) => c.iso_3166_1),
        production_companies: data.production_companies,
        spoken_languages: data.spoken_languages,
        networks: data.networks, // TV shows only
        title: data.title || data.name,
        name: data.name || data.title,
        original_language: data.original_language,
      };

      tmdbCache.set(cacheKey, { data: classifierInput, timestamp: Date.now() });

      // Evict old entries
      if (tmdbCache.size > 1000) {
        const oldest = [...tmdbCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        oldest.slice(0, 200).forEach(([k]) => tmdbCache.delete(k));
      }

      return classifierInput;
    }
  } catch {
    // TMDB unavailable — fall through
  }
  return null;
}

// ─── Fetch health data from subs server ──────────────────────────────
async function fetchHealthData(tmdbId: string, type: string): Promise<HealthData | null> {
  if (healthCache.data && Date.now() - healthCache.timestamp < HEALTH_CACHE_TTL) {
    return healthCache.data;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

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
    // Health server unavailable
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

// ─── Fetch dynamic affinity from HF telemetry engine ─────────────────
const affinityCache = { data: null as Record<string, Record<string, number>> | null, timestamp: 0 };
const AFFINITY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchDynamicAffinity(): Promise<Record<string, Record<string, number>> | null> {
  if (affinityCache.data && Date.now() - affinityCache.timestamp < AFFINITY_CACHE_TTL) {
    return affinityCache.data;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(`${SUBS_URL}/provider-affinity`, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.affinity && data.data_points > 10) {
        affinityCache.data = data.affinity;
        affinityCache.timestamp = Date.now();
        return data.affinity;
      }
    }
  } catch {
    // Affinity server unavailable — use static matrix
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN HANDLER — V6 Self-Learning
// ═══════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get('id');
  const type = (searchParams.get('type') || 'movie') as 'movie' | 'tv';
  const season = searchParams.get('season') ? parseInt(searchParams.get('season')!) : undefined;
  const episode = searchParams.get('episode') ? parseInt(searchParams.get('episode')!) : undefined;
  // Client can pass pre-computed category to skip TMDB fetch
  const clientCategory = searchParams.get('category') as ContentCategory | null;

  if (!tmdbId) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  // ── Cache lookup ──
  const cacheKey = `${tmdbId}-${type}-${season ?? 0}-${episode ?? 0}`;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < FEATURES.STREAM_CACHE_TTL_MS) {
    return NextResponse.json({
      providers: cached.providers,
      fromCache: true,
      category: cached.category,
    });
  }

  // ── Fetch providers + health + TMDB + dynamic affinity in parallel (4-way race) ──
  const [allProviders, healthData, tmdbData, dynamicAffinity] = await Promise.all([
    getProviders(),
    fetchHealthData(tmdbId, type),
    clientCategory ? Promise.resolve(null) : fetchTMDBForClassification(tmdbId, type),
    fetchDynamicAffinity(),
  ]);

  // ── Classify content ──
  const category: ContentCategory = clientCategory || (tmdbData ? classifyContent(tmdbData) : 'general');

  const enabledProviders = allProviders.filter(p => p.enabled && p.failCount < 5);

  // ── Build health lookup map ──
  const healthMap = new Map<string, HealthEntry>();
  if (healthData?.providers) {
    for (const hp of healthData.providers) {
      healthMap.set(hp.id, hp);
    }
  }

  // ── Apply SMART SCORE V6 with self-learning affinity ──
  const resolved: ResolvedProvider[] = enabledProviders.map(provider => {
    const liveHealth = healthMap.get(provider.id);

    const globalScore = liveHealth?.health_score ?? provider.healthScore ?? 50;
    const alive = liveHealth ? liveHealth.alive : true;
    const latencyMs = liveHealth?.latency ?? 3000;
    const prewarmed = !!liveHealth && healthData?.from_cache === true;
    const prewarmedAlive = prewarmed && (liveHealth?.alive ?? false);
    const userOk = liveHealth?.user_reports?.ok ?? 0;
    const userFail = liveHealth?.user_reports?.fail ?? 0;

    // Content affinity: prefer DYNAMIC (from real telemetry) over STATIC (hardcoded)
    let affinityBoost: number;
    const dynamicScore = dynamicAffinity?.[category]?.[provider.id];
    if (dynamicScore !== undefined) {
      // Dynamic affinity from real user telemetry — this is the self-learning part
      affinityBoost = dynamicScore;
    } else {
      // Fall back to static classifier matrix (cold start)
      affinityBoost = getProviderBoost(provider.id, category);
    }

    const smartScore = computeSmartScore({
      globalScore,
      affinityBoost,
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
      affinityBoost,
      latency: latencyMs,
      alive,
      source: prewarmed ? 'prewarm' : liveHealth ? 'global' : 'static',
    };
  });

  // ── Sort: smartScore desc → latency asc ──
  resolved.sort((a, b) => {
    if (b.smartScore !== a.smartScore) return b.smartScore - a.smartScore;
    return (a.latency ?? 9999) - (b.latency ?? 9999);
  });

  // ── Filter dead ──
  const live = resolved.filter(r => r.smartScore > 0 || r.source === 'static');
  const final = live.length > 0 ? live : resolved;

  // ── Cache ──
  streamCache.set(cacheKey, { providers: final, category, timestamp: Date.now() });
  if (streamCache.size > 500) {
    const sorted = [...streamCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    sorted.slice(0, 100).forEach(([k]) => streamCache.delete(k));
  }

  return NextResponse.json({
    providers: final,
    fromCache: false,
    category,
    contentTitle: tmdbData?.title || tmdbData?.name || null,
    healthEngine: !!healthData,
    affinitySource: dynamicAffinity ? 'telemetry' : 'static',
    algorithm: 'smart-v6-self-learning',
    topServer: final[0]?.id,
    topScore: final[0]?.smartScore,
    topAffinity: final[0]?.affinityBoost,
  });
}

