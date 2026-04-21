// ─── ATMOS V4.0 — Central Configuration ────────────────────────────
// All URL constants, TMDB config, genre mappings, and feature flags

// ─── Backend URLs ──────────────────────────────────────────────────
export const CONTROL_URL = process.env.NEXT_PUBLIC_CONTROL_URL || "https://nikhil1776-gdrivefwd.hf.space";
export const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL || "https://nikhil1776-atmos-media.hf.space";
export const META_URL = process.env.NEXT_PUBLIC_META_URL || "https://nikhil1776-atmos-meta.hf.space";
export const SUBS_URL = process.env.NEXT_PUBLIC_SUBS_URL || "https://nikhil1776-atmos-subs.hf.space";

// ─── TMDB Configuration ────────────────────────────────────────────
export const TMDB_API_KEY = process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY || "";
export const TMDB_BASE = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
export const TMDB_POSTER_SIZES = {
  small: "w185",
  medium: "w342",
  large: "w500",
  original: "original",
} as const;
export const TMDB_BACKDROP_SIZES = {
  small: "w780",
  large: "w1280",
  original: "original",
} as const;

// ─── Genre Mappings (TMDB IDs) ─────────────────────────────────────
export const GENRES = [
  { id: 28, name: "Action", slug: "action" },
  { id: 12, name: "Adventure", slug: "adventure" },
  { id: 16, name: "Animation", slug: "animation" },
  { id: 35, name: "Comedy", slug: "comedy" },
  { id: 80, name: "Crime", slug: "crime" },
  { id: 99, name: "Documentary", slug: "documentary" },
  { id: 18, name: "Drama", slug: "drama" },
  { id: 14, name: "Fantasy", slug: "fantasy" },
  { id: 27, name: "Horror", slug: "horror" },
  { id: 9648, name: "Mystery", slug: "mystery" },
  { id: 10749, name: "Romance", slug: "romance" },
  { id: 878, name: "Sci-Fi", slug: "sci-fi" },
  { id: 53, name: "Thriller", slug: "thriller" },
  { id: 10752, name: "War", slug: "war" },
] as const;

export const TV_GENRES = [
  { id: 10759, name: "Action & Adventure", slug: "action-adventure" },
  { id: 16, name: "Animation", slug: "animation" },
  { id: 35, name: "Comedy", slug: "comedy" },
  { id: 80, name: "Crime", slug: "crime" },
  { id: 99, name: "Documentary", slug: "documentary" },
  { id: 18, name: "Drama", slug: "drama" },
  { id: 10765, name: "Sci-Fi & Fantasy", slug: "sci-fi-fantasy" },
  { id: 9648, name: "Mystery", slug: "mystery" },
] as const;

// ─── Content Row Configurations ────────────────────────────────────
export const HOME_ROWS = [
  { id: "trending", title: "Trending Now", endpoint: "trending/all/week" },
  { id: "popular_movies", title: "Popular Movies", endpoint: "movie/popular" },
  { id: "top_rated_tv", title: "Top Rated TV", endpoint: "tv/top_rated" },
  { id: "now_playing", title: "New Releases", endpoint: "movie/now_playing" },
  { id: "action", title: "Action Movies", endpoint: "discover/movie", params: { with_genres: "28" } },
  { id: "anime", title: "Anime", endpoint: "discover/tv", params: { with_genres: "16" } },
  { id: "thriller", title: "Thrillers", endpoint: "discover/movie", params: { with_genres: "53" } },
  { id: "scifi", title: "Sci-Fi", endpoint: "discover/movie", params: { with_genres: "878" } },
] as const;

// ─── Feature Flags ─────────────────────────────────────────────────
export const FEATURES = {
  ENABLE_USER_AUTH: true,
  ENABLE_WATCHLIST: true,
  ENABLE_WATCH_HISTORY: true,
  ENABLE_DRIVE_LIBRARY: true,
  PROVIDER_RACE_TIMEOUT_MS: 4000,
  PROVIDER_MAX_FAILURES: 3,
  STREAM_CACHE_TTL_MS: 60 * 60 * 1000, // 1 hour
  TITLE_CACHE_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
} as const;

// ─── Admin (server-side only — do NOT use in client components) ────
// ADMIN_PASSWORD is read from env on server API routes only.
// Never import this in "use client" files.
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1908';
