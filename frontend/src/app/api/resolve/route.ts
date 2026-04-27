import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PROVIDERS, buildProviderUrl } from '@/lib/providers';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get('id');
  const type = (searchParams.get('type') || 'movie') as 'movie' | 'tv';
  const season = searchParams.get('season') ? parseInt(searchParams.get('season')!) : undefined;
  const episode = searchParams.get('episode') ? parseInt(searchParams.get('episode')!) : undefined;

  if (!tmdbId) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  const enabledProviders = DEFAULT_PROVIDERS.filter(p => p.enabled);

  const resolved = enabledProviders.map(provider => {
    return {
      id: provider.id,
      name: provider.name || provider.id,
      url: buildProviderUrl(provider, tmdbId, type, season, episode),
      priority: provider.priority,
      healthScore: 100,
      smartScore: 100 - provider.priority,
      affinityBoost: 0,
      latency: 0,
      alive: true,
      source: 'static',
    };
  });

  // Sort strictly by priority (static sort)
  resolved.sort((a, b) => a.priority - b.priority);

  return NextResponse.json({
    providers: resolved,
    fromCache: true,
    category: 'general',
    healthEngine: false,
    affinitySource: 'static',
    algorithm: 'static-v1',
    topServer: resolved[0]?.id,
    topScore: resolved[0]?.smartScore,
    topAffinity: 0,
  });
}
