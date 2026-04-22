// ─── ATMOS V4.0 — Provider Registry ─────────────────────────────────
// Central registry of all streaming embed providers with health tracking
// Providers verified: 2026-04-20 — only includes iframe-embeddable sources
// Priority: ad-free/clean first, then reliable, then fallbacks

export interface Provider {
  id: string;
  name: string;
  slug: string;
  /** URL pattern with {tmdb_id}, {type}, {season}, {episode} placeholders */
  urlPattern: string;
  /** Custom URL builder tag for special URL formats */
  urlStyle: 'path' | 'dash' | 'query' | 'custom';
  enabled: boolean;
  priority: number;       // 1 = highest priority
  healthScore: number;    // 0-100
  failCount: number;
  lastChecked: number;    // timestamp
}

export interface ResolvedProvider {
  id: string;
  name: string;
  url: string;
  priority: number;
  healthScore: number;
}

// ─── Default Providers (verified working, iframe-safe) ─────────────
export const DEFAULT_PROVIDERS: Provider[] = [
  // ── Tier 1: Clean, fast, minimal ads ──
  {
    id: "vidlink",
    name: "VidLink (Ad-Free Proxy)",
    slug: "vidlink",
    urlPattern: "https://atmos-proxy.nkp9450732628.workers.dev/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 1,
    healthScore: 100,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "vidsrc_icu",
    name: "VidSrc ICU",
    slug: "vidsrc-icu",
    urlPattern: "https://vidsrc.icu/embed/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 2,
    healthScore: 98,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "videasy",
    name: "Videasy",
    slug: "videasy",
    urlPattern: "https://player.videasy.net/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 3,
    healthScore: 95,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "nontongo",
    name: "NonTongo",
    slug: "nontongo",
    urlPattern: "https://nontongo.win/embed/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 4,
    healthScore: 92,
    failCount: 0,
    lastChecked: 0,
  },

  // ── Tier 2: Reliable, may have minor ads ──
  {
    id: "vidjoy",
    name: "VidJoy",
    slug: "vidjoy",
    urlPattern: "https://vidjoy.pro/embed/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 5,
    healthScore: 88,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "vidfast",
    name: "VidFast",
    slug: "vidfast",
    urlPattern: "https://vidfast.pro/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 6,
    healthScore: 85,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "autoembed",
    name: "AutoEmbed",
    slug: "autoembed",
    urlPattern: "https://autoembed.co/{type}/tmdb/{tmdb_id}",
    urlStyle: 'dash',
    enabled: true,
    priority: 7,
    healthScore: 82,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "2embed",
    name: "2Embed",
    slug: "2embed",
    urlPattern: "https://www.2embed.cc/embed/{type}/{tmdb_id}",
    urlStyle: 'custom',
    enabled: true,
    priority: 8,
    healthScore: 80,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "moviesapi",
    name: "MoviesAPI",
    slug: "moviesapi",
    urlPattern: "https://moviesapi.club/{type}/{tmdb_id}",
    urlStyle: 'dash',
    enabled: true,
    priority: 9,
    healthScore: 75,
    failCount: 0,
    lastChecked: 0,
  },

  // ── Tier 3: Fallback servers ──
  {
    id: "vidsrc_xyz",
    name: "VidSrc Pro",
    slug: "vidsrc-xyz",
    urlPattern: "https://vidsrc.xyz/embed/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 10,
    healthScore: 60,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "vidsrc_me",
    name: "VidSrc ME",
    slug: "vidsrc-me",
    urlPattern: "https://vidsrc.me/embed/{type}?tmdb={tmdb_id}",
    urlStyle: 'query',
    enabled: true,
    priority: 11,
    healthScore: 55,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "embed_su",
    name: "Embed SU",
    slug: "embed-su",
    urlPattern: "https://embed.su/embed/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 12,
    healthScore: 50,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "vidsrc_cc",
    name: "VidSrc CC",
    slug: "vidsrc-cc",
    urlPattern: "https://vidsrc.cc/v2/embed/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 13,
    healthScore: 45,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "multiembed",
    name: "MultiEmbed",
    slug: "multiembed",
    urlPattern: "https://multiembed.mov/?video_id={tmdb_id}&tmdb=1",
    urlStyle: 'query',
    enabled: true,
    priority: 14,
    healthScore: 40,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "vidsrc_in",
    name: "VidSrc IN",
    slug: "vidsrc-in",
    urlPattern: "https://vidsrc.in/embed/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 15,
    healthScore: 35,
    failCount: 0,
    lastChecked: 0,
  },
];

// ─── URL Builder ────────────────────────────────────────────────────
export function buildProviderUrl(
  provider: Provider,
  tmdbId: string,
  type: "movie" | "tv",
  season?: number,
  episode?: number,
): string {
  let url = provider.urlPattern
    .replace("{tmdb_id}", tmdbId)
    .replace("{type}", type);

  // For movies, no season/episode needed
  if (type !== "tv" || !season || !episode) {
    // Special case: 2embed movie URL
    if (provider.id === '2embed') {
      return `https://www.2embed.cc/embed/${tmdbId}`;
    }
    return url;
  }

  // ── TV Shows: append season/episode based on urlStyle ──
  switch (provider.urlStyle) {
    case 'path':
      // /embed/tv/85552/1/1
      url += `/${season}/${episode}`;
      break;

    case 'dash':
      // /tv/tmdb/85552-1-1 or /tv/85552-1-1
      url += `-${season}-${episode}`;
      break;

    case 'query':
      // ?tmdb=85552&season=1&episode=1 or ?video_id=X&s=1&e=1
      if (url.includes('multiembed.mov')) {
        url += `&s=${season}&e=${episode}`;
      } else {
        url += `&season=${season}&episode=${episode}`;
      }
      break;

    case 'custom':
      // 2embed: movie -> /embed/movie/ID, tv -> /embedtv/ID?s=S&e=E
      if (provider.id === '2embed') {
        if (type === 'tv' && season && episode) {
          url = `https://www.2embed.cc/embedtv/${tmdbId}?s=${season}&e=${episode}`;
        } else {
          url = `https://www.2embed.cc/embed/movie/${tmdbId}`;
        }
      } else {
        url += `/${season}/${episode}`;
      }
      break;

    default:
      url += `/${season}/${episode}`;
  }

  return url;
}

// ─── Provider Sorting ───────────────────────────────────────────────
export function sortProviders(providers: Provider[]): Provider[] {
  return [...providers]
    .filter(p => p.enabled && p.healthScore > 0)
    .sort((a, b) => {
      // Primary: priority (lower = better)
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Secondary: healthScore (higher = better)
      return b.healthScore - a.healthScore;
    });
}

// ─── Health Tracking ────────────────────────────────────────────────
export function recordProviderFailure(provider: Provider): Provider {
  const newFailCount = provider.failCount + 1;
  const newHealth = Math.max(0, provider.healthScore - 20);
  return {
    ...provider,
    failCount: newFailCount,
    healthScore: newHealth,
    lastChecked: Date.now(),
    // Auto-disable after too many failures
    enabled: newFailCount < 5 ? provider.enabled : false,
  };
}

export function recordProviderSuccess(provider: Provider): Provider {
  return {
    ...provider,
    failCount: 0,
    healthScore: Math.min(100, provider.healthScore + 5),
    lastChecked: Date.now(),
  };
}
