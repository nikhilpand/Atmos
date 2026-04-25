// ─── ATMOS V5.0 — Provider Registry ─────────────────────────────────
// Verified 2026-04-25 — dead providers removed, new providers added.
// Priority ordered by: speed → reliability → library size
// All providers tested with Inception (TMDB 27205)

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
// Last verified: 2026-04-25
// Dead/removed: embed_su, vidsrc_me, vidsrc_xyz, vidsrc_cc, multiembed,
//               vidsrc_in, smashystream, vidplay, vidora, warezcdn,
//               frembed, cinescrape, superembed, rive
export const DEFAULT_PROVIDERS: Provider[] = [
  // ── Tier 1: Fastest (<1s response), Clean ──
  {
    id: "videasy",
    name: "Videasy",
    slug: "videasy",
    urlPattern: "https://player.videasy.net/{type}/{tmdb_id}",
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
    healthScore: 100,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "vidlink",
    name: "VidLink",
    slug: "vidlink",
    urlPattern: "https://atmos-proxy.nkp9450732628.workers.dev/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 3,
    healthScore: 98,
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
    priority: 4,
    healthScore: 98,
    failCount: 0,
    lastChecked: 0,
  },

  // ── Tier 2: Fast (<2s response), Reliable ──
  {
    id: "vidsrc_dev",
    name: "VidSrc Dev",
    slug: "vidsrc-dev",
    urlPattern: "https://vidsrc.dev/embed/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 5,
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
    priority: 6,
    healthScore: 95,
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
    priority: 7,
    healthScore: 92,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "vidjoy",
    name: "VidJoy",
    slug: "vidjoy",
    urlPattern: "https://vidjoy.pro/embed/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 8,
    healthScore: 90,
    failCount: 0,
    lastChecked: 0,
  },
  {
    id: "vidsrc_wtf",
    name: "VidSrc WTF",
    slug: "vidsrc-wtf",
    urlPattern: "https://vidsrc.wtf/api/3/{type}/?id={tmdb_id}",
    urlStyle: 'query',
    enabled: true,
    priority: 9,
    healthScore: 88,
    failCount: 0,
    lastChecked: 0,
  },

  // ── Tier 3: Slower but reliable fallbacks ──
  {
    id: "111movies",
    name: "111Movies",
    slug: "111movies",
    urlPattern: "https://111movies.com/{type}/{tmdb_id}",
    urlStyle: 'path',
    enabled: true,
    priority: 10,
    healthScore: 82,
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
    priority: 11,
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
    priority: 12,
    healthScore: 70,
    failCount: 0,
    lastChecked: 0,
  },
];

// ─── URL Builder ────────────────────────────────────────────────────
// VidLink customization params for ad-free, fully-featured playback
const VIDLINK_PARAMS = 'primaryColor=8b5cf6&secondaryColor=1e1e2e&iconColor=ffffff&icons=vid&title=true&poster=true&autoplay=true&nextbutton=true';

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
    // Add VidLink customization params
    if (provider.id === 'vidlink') {
      url += `?${VIDLINK_PARAMS}`;
    }
    return url;
  }

  // ── TV Shows: append season/episode based on urlStyle ──
  switch (provider.urlStyle) {
    case 'path':
      url += `/${season}/${episode}`;
      break;

    case 'dash':
      url += `-${season}-${episode}`;
      break;

    case 'query':
      if (url.includes('vidsrc.wtf')) {
        // vidsrc.wtf uses &s=&e= format
        url += `&s=${season}&e=${episode}`;
      } else {
        url += `&season=${season}&episode=${episode}`;
      }
      break;

    case 'custom':
      if (provider.id === '2embed') {
        url = `https://www.2embed.cc/embedtv/${tmdbId}?s=${season}&e=${episode}`;
      } else {
        url += `/${season}/${episode}`;
      }
      break;

    default:
      url += `/${season}/${episode}`;
  }

  // Add VidLink customization params (after season/episode are appended)
  if (provider.id === 'vidlink') {
    url += (url.includes('?') ? '&' : '?') + VIDLINK_PARAMS;
  }

  return url;
}

