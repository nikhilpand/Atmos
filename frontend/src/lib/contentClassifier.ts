// ═══════════════════════════════════════════════════════════════════════
// ATMOS V5.0 — Content Intelligence Classifier
// ═══════════════════════════════════════════════════════════════════════
// Classifies any title into a ContentCategory using TMDB metadata signals:
//   - genre_ids / genres
//   - origin_country
//   - production_companies
//   - spoken_languages
//   - keywords in title
//
// The category drives provider affinity scoring in the resolve engine.
// ═══════════════════════════════════════════════════════════════════════

// ─── Content Categories ─────────────────────────────────────────────
export type ContentCategory =
  | 'anime'
  | 'bollywood'
  | 'korean'          // K-Drama, K-Movie
  | 'turkish'
  | 'chinese'
  | 'netflix'
  | 'amazon'
  | 'hbo'
  | 'disney'
  | 'apple'
  | 'hotstar'         // Jio Cinema / Hotstar originals
  | 'paramount'
  | 'hollywood'       // Default western content
  | 'general';        // Unknown / unclassifiable

// ─── TMDB genre IDs ─────────────────────────────────────────────────
const ANIME_GENRE_IDS = new Set([16]); // Animation
const BOLLYWOOD_INDICATORS = new Set(['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu']); // Indian languages

// ─── Production company → category mapping ──────────────────────────
// These company names are normalized (lowercased, trimmed)
const COMPANY_MAP: Record<string, ContentCategory> = {
  // Netflix
  'netflix': 'netflix',
  'netflix animation': 'netflix',
  'netflix studios': 'netflix',

  // Amazon
  'amazon studios': 'amazon',
  'amazon prime video': 'amazon',
  'amazon mgm studios': 'amazon',
  'prime video': 'amazon',

  // HBO / Max
  'hbo': 'hbo',
  'hbo max': 'hbo',
  'hbo films': 'hbo',
  'home box office': 'hbo',
  'warner bros. television': 'hbo',
  'max original': 'hbo',

  // Disney+
  'disney+': 'disney',
  'disney plus': 'disney',
  'walt disney pictures': 'disney',
  'marvel studios': 'disney',
  'lucasfilm ltd.': 'disney',
  'pixar': 'disney',
  '20th century studios': 'disney',
  'disney television animation': 'disney',

  // Apple TV+
  'apple tv+': 'apple',
  'apple studios': 'apple',
  'apple original films': 'apple',
  'apple': 'apple',

  // Jio / Hotstar
  'jio studios': 'hotstar',
  'jio cinema': 'hotstar',
  'hotstar': 'hotstar',
  'hotstar specials': 'hotstar',
  'star india': 'hotstar',
  'star plus': 'hotstar',

  // Paramount
  'paramount+': 'paramount',
  'paramount television studios': 'paramount',
  'showtime': 'paramount',
  'cbs studios': 'paramount',

  // Anime studios (Japanese animation)
  'toei animation': 'anime',
  'madhouse': 'anime',
  'bones': 'anime',
  'mappa': 'anime',
  'wit studio': 'anime',
  'ufotable': 'anime',
  'a-1 pictures': 'anime',
  'studio ghibli': 'anime',
  'kyoto animation': 'anime',
  'sunrise': 'anime',
  'cloverworks': 'anime',
  'trigger': 'anime',
  'production i.g': 'anime',
  'shaft': 'anime',
  'j.c.staff': 'anime',
  'pierrot': 'anime',
  'studio pierrot': 'anime',
  'david production': 'anime',
  'brain\'s base': 'anime',
  'lerche': 'anime',
  'silver link': 'anime',
  'aniplex': 'anime',
  'funimation': 'anime',
  'crunchyroll': 'anime',
  'kodansha': 'anime',
  'shueisha': 'anime',
  'bandai namco': 'anime',
  'kadokawa': 'anime',

  // Bollywood studios
  'yash raj films': 'bollywood',
  'dharma productions': 'bollywood',
  'red chillies entertainment': 'bollywood',
  'eros international': 'bollywood',
  't-series': 'bollywood',
  'zee studios': 'bollywood',
  'reliance entertainment': 'bollywood',
  'colour yellow productions': 'bollywood',
  'nadiadwala grandson entertainment': 'bollywood',
  'excel entertainment': 'bollywood',
  'phantom films': 'bollywood',
  'tips films': 'bollywood',
  'balaji motion pictures': 'bollywood',
  'pen india limited': 'bollywood',
  'pen studios': 'bollywood',
  'viacom18 studios': 'bollywood',

  // Korean studios
  'studio dragon': 'korean',
  'cj entertainment': 'korean',
  'cj enm': 'korean',
  'showbox': 'korean',
  'next entertainment world': 'korean',
  'barunson e&a': 'korean',

  // Turkish studios
  'tims&b productions': 'turkish',
  'ay yapım': 'turkish',
  'med yapım': 'turkish',
  'o3 medya': 'turkish',

  // Chinese studios
  'china film group': 'chinese',
  'huanxi media': 'chinese',
  'alibaba pictures': 'chinese',
  'tencent pictures': 'chinese',
  'iqiyi': 'chinese',
  'wanda pictures': 'chinese',
  'bona film group': 'chinese',
};

// ─── Network → category mapping (for TV shows) ─────────────────────
const NETWORK_CATEGORY: Record<string, ContentCategory> = {
  'netflix': 'netflix',
  'amazon': 'amazon',
  'prime video': 'amazon',
  'hbo': 'hbo',
  'hbo max': 'hbo',
  'max': 'hbo',
  'disney+': 'disney',
  'disney+ hotstar': 'hotstar',
  'hotstar': 'hotstar',
  'jio cinema': 'hotstar',
  'apple tv+': 'apple',
  'paramount+': 'paramount',
  'showtime': 'paramount',
  'crunchyroll': 'anime',
  'funimation': 'anime',
  'tokyo mx': 'anime',
  'at-x': 'anime',
  'tv tokyo': 'anime',
  'fuji tv': 'anime',
  'nippon tv': 'anime',
  'animax': 'anime',
  'tvn': 'korean',
  'jtbc': 'korean',
  'kbs2': 'korean',
  'sbs': 'korean',
  'mbc': 'korean',
  'viki': 'korean',
  'star plus': 'hotstar',
  'zee tv': 'bollywood',
  'colors tv': 'bollywood',
  'sony liv': 'bollywood',
  'alt balaji': 'bollywood',
  'mx player': 'bollywood',
  'trt 1': 'turkish',
  'show tv': 'turkish',
  'star tv': 'turkish',
  'fox tv': 'turkish',
  'kanal d': 'turkish',
  'iqiyi': 'chinese',
  'youku': 'chinese',
  'mango tv': 'chinese',
  'tencent video': 'chinese',
};

// ─── Title keyword patterns ─────────────────────────────────────────
const ANIME_TITLE_KEYWORDS = [
  'shippuden', 'boruto', 'one piece', 'dragon ball', 'naruto',
  'bleach', 'attack on titan', 'shingeki', 'demon slayer', 'kimetsu',
  'jujutsu kaisen', 'my hero academia', 'boku no hero', 'hunter x hunter',
  'fullmetal alchemist', 'death note', 'tokyo ghoul', 'sword art online',
  'chainsaw man', 'spy x family', 'mob psycho', 'one punch man',
  'cowboy bebop', 'steins;gate', 'evangelion', 'code geass',
  'tokyo revengers', 'vinland saga', 'haikyuu', 'black clover',
  'fairy tail', 'seven deadly sins', 'fire force', 'blue lock',
  'solo leveling', 'mushoku tensei', 'oshi no ko', 'frieren',
  'dandadan', 'kaiju no', 'jojo', 'berserk', 'gintama',
  'slam dunk', 'initial d', 'inuyasha', 'yu yu hakusho',
  'doraemon', 'shin-chan', 'pokemon', 'digimon', 'beyblade',
];

// ─── TMDB metadata interface (subset of what we receive) ────────────
export interface ClassifierInput {
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  origin_country?: string[];
  production_companies?: { id: number; name: string; logo_path?: string; origin_country?: string }[];
  spoken_languages?: { english_name: string; iso_639_1: string; name: string }[];
  networks?: { id: number; name: string }[];
  title?: string;
  name?: string;
  original_language?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN CLASSIFIER — Multi-signal voting with confidence
// ═══════════════════════════════════════════════════════════════════════
export function classifyContent(input: ClassifierInput): ContentCategory {
  const votes = new Map<ContentCategory, number>();
  const addVote = (cat: ContentCategory, weight: number) => {
    votes.set(cat, (votes.get(cat) || 0) + weight);
  };

  // ── Signal 1: Production Companies (strongest signal, weight: 5) ──
  if (input.production_companies) {
    for (const company of input.production_companies) {
      const normalized = company.name.toLowerCase().trim();
      // Exact match
      if (COMPANY_MAP[normalized]) {
        addVote(COMPANY_MAP[normalized], 5);
      }
      // Partial match (e.g., "Netflix Originals" → netflix)
      for (const [key, cat] of Object.entries(COMPANY_MAP)) {
        if (normalized.includes(key) || key.includes(normalized)) {
          addVote(cat, 3);
        }
      }
    }
  }

  // ── Signal 2: Networks (strong for TV, weight: 6) ──
  if (input.networks) {
    for (const network of input.networks) {
      const normalized = network.name.toLowerCase().trim();
      if (NETWORK_CATEGORY[normalized]) {
        addVote(NETWORK_CATEGORY[normalized], 6);
      }
      for (const [key, cat] of Object.entries(NETWORK_CATEGORY)) {
        if (normalized.includes(key)) {
          addVote(cat, 4);
        }
      }
    }
  }

  // ── Signal 3: Origin Country (weight: 4) ──
  if (input.origin_country) {
    for (const country of input.origin_country) {
      const c = country.toUpperCase();
      if (c === 'JP') addVote('anime', 3); // JP alone doesn't guarantee anime
      if (c === 'IN') addVote('bollywood', 4);
      if (c === 'KR') addVote('korean', 4);
      if (c === 'TR') addVote('turkish', 4);
      if (c === 'CN' || c === 'TW' || c === 'HK') addVote('chinese', 4);
    }
  }

  // ── Signal 4: Genres (weight: 3) ──
  const genreIds = input.genre_ids || input.genres?.map(g => g.id) || [];
  const isAnimation = genreIds.some(id => ANIME_GENRE_IDS.has(id));
  const isJapanese = input.origin_country?.includes('JP') || input.original_language === 'ja';

  if (isAnimation && isJapanese) {
    addVote('anime', 6); // Animation + Japanese = strong anime signal
  } else if (isAnimation && input.original_language === 'ja') {
    addVote('anime', 5);
  }

  // ── Signal 5: Language (weight: 3) ──
  if (input.original_language === 'ja' && isAnimation) {
    addVote('anime', 4);
  } else if (input.original_language === 'ja') {
    addVote('anime', 2); // Japanese live-action could still be anime-adjacent
  }
  if (input.original_language === 'ko') addVote('korean', 3);
  if (input.original_language === 'tr') addVote('turkish', 3);
  if (input.original_language === 'zh') addVote('chinese', 3);

  if (input.spoken_languages) {
    for (const lang of input.spoken_languages) {
      if (BOLLYWOOD_INDICATORS.has(lang.iso_639_1)) {
        addVote('bollywood', 3);
      }
    }
  }
  if (input.original_language && BOLLYWOOD_INDICATORS.has(input.original_language)) {
    addVote('bollywood', 4);
  }

  // ── Signal 6: Title keyword matching (weight: 5) ──
  const titleLower = (input.title || input.name || '').toLowerCase();
  if (titleLower) {
    for (const keyword of ANIME_TITLE_KEYWORDS) {
      if (titleLower.includes(keyword)) {
        addVote('anime', 5);
        break; // One match is enough
      }
    }
  }

  // ── Resolve: highest-voted category wins ──
  let bestCategory: ContentCategory = 'general';
  let bestScore = 0;

  for (const [cat, score] of votes.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }

  // If no strong signal (score < 3), default to hollywood for EN, general otherwise
  if (bestScore < 3) {
    if (input.original_language === 'en') return 'hollywood';
    return 'general';
  }

  return bestCategory;
}

// ═══════════════════════════════════════════════════════════════════════
// PROVIDER AFFINITY MATRIX
// ═══════════════════════════════════════════════════════════════════════
// Maps each ContentCategory to provider boost/penalty scores.
// Positive = boost, Negative = penalty, 0 = neutral.
// Max boost: +25 (added to smartScore), Max penalty: -15
//
// Based on empirical testing of which providers have best coverage for
// each content type. Updated 2026-04-25.
// ═══════════════════════════════════════════════════════════════════════

const PROVIDER_AFFINITY: Record<ContentCategory, Record<string, number>> = {
  anime: {
    // These providers have excellent anime coverage
    videasy: 20,        // Strong anime library
    vidsrc_icu: 15,     // Good anime
    nontongo: 15,       // Solid anime
    vidsrc_dev: 12,     // Decent anime
    vidlink: 10,        // Fair anime
    autoembed: 10,      // Aggregates well
    '2embed': 5,
    vidsrc_wtf: 5,
    '111movies': 0,
    vidjoy: 0,
    vidfast: 0,
    moviesapi: -5,      // Weak on anime
  },

  bollywood: {
    // Providers with good Indian content coverage
    vidsrc_icu: 20,     // Strong regional
    videasy: 15,        // Good Bollywood
    autoembed: 15,      // Aggregates Indian
    '2embed': 12,
    nontongo: 10,
    vidsrc_dev: 10,
    vidsrc_wtf: 8,
    vidlink: 5,
    '111movies': 5,
    vidjoy: 0,
    vidfast: 0,
    moviesapi: -5,
  },

  korean: {
    vidsrc_icu: 20,
    videasy: 18,
    nontongo: 15,
    vidsrc_dev: 12,
    autoembed: 12,
    '2embed': 10,
    vidlink: 8,
    vidsrc_wtf: 5,
    vidjoy: 0,
    vidfast: 0,
    '111movies': 0,
    moviesapi: -5,
  },

  turkish: {
    vidsrc_icu: 18,
    videasy: 15,
    autoembed: 12,
    nontongo: 10,
    vidsrc_dev: 10,
    '2embed': 8,
    vidlink: 5,
    vidsrc_wtf: 5,
    vidjoy: 0,
    vidfast: 0,
    '111movies': 0,
    moviesapi: -5,
  },

  chinese: {
    vidsrc_icu: 18,
    videasy: 15,
    autoembed: 12,
    nontongo: 10,
    vidsrc_dev: 10,
    '2embed': 8,
    vidlink: 5,
    vidsrc_wtf: 5,
    vidjoy: 0,
    vidfast: 0,
    '111movies': 0,
    moviesapi: -5,
  },

  netflix: {
    // Netflix originals available widely
    videasy: 20,
    vidlink: 18,        // VidLink has great Netflix
    vidsrc_icu: 15,
    vidsrc_dev: 15,
    nontongo: 12,
    vidjoy: 10,
    vidfast: 10,
    autoembed: 10,
    '2embed': 8,
    vidsrc_wtf: 8,
    '111movies': 5,
    moviesapi: 5,
  },

  amazon: {
    videasy: 20,
    vidlink: 18,
    vidsrc_icu: 15,
    vidsrc_dev: 15,
    nontongo: 12,
    autoembed: 12,
    vidjoy: 10,
    vidfast: 10,
    '2embed': 8,
    vidsrc_wtf: 8,
    '111movies': 5,
    moviesapi: 5,
  },

  hbo: {
    // HBO/Max content — VidLink and VidSrc excel
    vidlink: 22,
    videasy: 20,
    vidsrc_icu: 18,
    vidsrc_dev: 15,
    nontongo: 12,
    vidjoy: 10,
    vidfast: 10,
    autoembed: 10,
    '2embed': 8,
    vidsrc_wtf: 8,
    '111movies': 5,
    moviesapi: 5,
  },

  disney: {
    videasy: 20,
    vidlink: 18,
    vidsrc_icu: 15,
    vidsrc_dev: 15,
    nontongo: 12,
    vidjoy: 10,
    vidfast: 10,
    autoembed: 10,
    '2embed': 8,
    vidsrc_wtf: 8,
    '111movies': 5,
    moviesapi: 5,
  },

  apple: {
    vidlink: 22,        // VidLink great for Apple TV+
    videasy: 20,
    vidsrc_icu: 15,
    vidsrc_dev: 15,
    nontongo: 12,
    autoembed: 10,
    vidjoy: 8,
    vidfast: 8,
    '2embed': 5,
    vidsrc_wtf: 5,
    '111movies': 0,
    moviesapi: -5,
  },

  hotstar: {
    // Jio Cinema / Hotstar — Indian providers prioritized
    vidsrc_icu: 22,
    videasy: 18,
    autoembed: 15,
    nontongo: 12,
    '2embed': 10,
    vidsrc_dev: 10,
    vidsrc_wtf: 8,
    vidlink: 5,
    '111movies': 5,
    vidjoy: 0,
    vidfast: 0,
    moviesapi: -5,
  },

  paramount: {
    videasy: 20,
    vidlink: 18,
    vidsrc_icu: 15,
    vidsrc_dev: 15,
    nontongo: 12,
    vidjoy: 10,
    vidfast: 10,
    autoembed: 10,
    '2embed': 8,
    vidsrc_wtf: 8,
    '111movies': 5,
    moviesapi: 5,
  },

  hollywood: {
    // Mainstream Hollywood — all providers are good
    videasy: 15,
    vidlink: 15,
    vidsrc_icu: 12,
    vidsrc_dev: 12,
    vidfast: 10,
    vidjoy: 10,
    nontongo: 10,
    '2embed': 8,
    autoembed: 8,
    vidsrc_wtf: 5,
    '111movies': 5,
    moviesapi: 5,
  },

  general: {
    // No strong signal — balanced scoring
    videasy: 10,
    vidsrc_icu: 10,
    vidlink: 10,
    vidsrc_dev: 8,
    nontongo: 8,
    vidfast: 5,
    vidjoy: 5,
    '2embed': 5,
    autoembed: 5,
    vidsrc_wtf: 3,
    '111movies': 3,
    moviesapi: 0,
  },
};

// ─── Get provider affinity boost for a given category ───────────────
export function getProviderBoost(providerId: string, category: ContentCategory): number {
  const affinityMap = PROVIDER_AFFINITY[category] || PROVIDER_AFFINITY.general;
  return affinityMap[providerId] ?? 0;
}
