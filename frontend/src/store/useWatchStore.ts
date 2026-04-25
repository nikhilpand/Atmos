// ═══════════════════════════════════════════════════════════════════════
// ATMOS V6 — Watch State Store (Zustand + localStorage)
// ═══════════════════════════════════════════════════════════════════════
// Tracks watch progress for:
//   1. "Continue Watching" row on homepage
//   2. "Up Next" auto-play countdown
//   3. Episode completion badges in episode drawer
//   4. "Because you watched..." recommendation seed
//
// Persists to localStorage automatically. Zero backend needed.
// When Supabase is connected, can optionally sync to cloud.
// ═══════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from './useAuthStore';

// ─── Types ──────────────────────────────────────────────────────────
export interface WatchEntry {
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  season?: number;
  episode?: number;
  /** 0-100 percentage watched */
  progress: number;
  /** Seconds into the video */
  currentTime: number;
  /** Total video duration in seconds */
  duration: number;
  /** Genre IDs for recommendation engine */
  genreIds: number[];
  /** Content category from classifier */
  category?: string;
  /** Timestamp of last update */
  updatedAt: number;
  /** True when progress >= 92% */
  completed: boolean;
}

export interface ProviderPerformance {
  providerId: string;
  tmdbId: string;
  category: string;
  success: boolean;
  latencyMs: number;
  timestamp: number;
}

interface WatchState {
  // ── Watch History ──
  entries: Record<string, WatchEntry>;  // Key: "tmdbId" or "tmdbId:S:E"

  // ── Provider Telemetry (local buffer) ──
  telemetryBuffer: ProviderPerformance[];

  // ── Actions ──
  updateProgress: (entry: Omit<WatchEntry, 'updatedAt' | 'completed'>) => void;
  getEntry: (tmdbId: string, season?: number, episode?: number) => WatchEntry | null;
  getContinueWatching: () => WatchEntry[];
  getCompletedTitles: () => WatchEntry[];
  getRecentGenres: () => { genreId: number; count: number }[];
  isEpisodeCompleted: (tmdbId: string, season: number, episode: number) => boolean;
  clearEntry: (key: string) => void;
  clearAll: () => void;

  // ── Telemetry ──
  recordProviderPerformance: (perf: Omit<ProviderPerformance, 'timestamp'>) => void;
  flushTelemetry: () => ProviderPerformance[];

  // ── Supabase Sync ──
  initSync: (userId: string) => Promise<void>;
}

function makeKey(tmdbId: string, season?: number, episode?: number): string {
  if (season !== undefined && episode !== undefined) {
    return `${tmdbId}:${season}:${episode}`;
  }
  return tmdbId;
}

export const useWatchStore = create<WatchState>()(
  persist(
    (set, get) => ({
      entries: {},
      telemetryBuffer: [],

      updateProgress: (entry) => {
        const key = makeKey(entry.tmdbId, entry.season, entry.episode);
        const completed = entry.progress >= 92;

        set((state) => ({
          entries: {
            ...state.entries,
            [key]: {
              ...entry,
              updatedAt: Date.now(),
              completed,
            },
          },
        }));

        // Supabase Background Sync
        const user = useAuthStore.getState().user;
        if (user && supabase) {
          supabase.from('watch_history').upsert({
            user_id: user.id,
            key: key,
            tmdb_id: entry.tmdbId,
            media_type: entry.mediaType,
            title: entry.title,
            poster_path: entry.posterPath,
            backdrop_path: entry.backdropPath,
            season: entry.season,
            episode: entry.episode,
            progress: entry.progress,
            current_time: entry.currentTime,
            duration: entry.duration,
            genre_ids: entry.genreIds,
            category: entry.category,
            completed: completed,
            updated_at: new Date(Date.now()).toISOString(),
          }).then(({ error }) => {
            if (error) console.error("Sync failed:", error);
          });
        }
      },

      getEntry: (tmdbId, season, episode) => {
        const key = makeKey(tmdbId, season, episode);
        return get().entries[key] || null;
      },

      getContinueWatching: () => {
        const entries = Object.values(get().entries);
        return entries
          .filter(e => !e.completed && e.progress > 3 && e.progress < 92)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 20);  // Max 20 items in Continue Watching
      },

      getCompletedTitles: () => {
        const entries = Object.values(get().entries);
        // Deduplicate by tmdbId (for TV, take the most recent episode)
        const seen = new Map<string, WatchEntry>();
        for (const e of entries) {
          if (!e.completed) continue;
          const existing = seen.get(e.tmdbId);
          if (!existing || e.updatedAt > existing.updatedAt) {
            seen.set(e.tmdbId, e);
          }
        }
        return Array.from(seen.values())
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 10);
      },

      getRecentGenres: () => {
        const entries = Object.values(get().entries);
        const genreCount = new Map<number, number>();

        // Only consider recent watches (last 30 days)
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        for (const e of entries) {
          if (e.updatedAt < cutoff) continue;
          if (!e.genreIds) continue;
          // Weight by progress — 90% watched = full weight, 10% = low weight
          const weight = Math.max(0.1, e.progress / 100);
          for (const gid of e.genreIds) {
            genreCount.set(gid, (genreCount.get(gid) || 0) + weight);
          }
        }

        return Array.from(genreCount.entries())
          .map(([genreId, count]) => ({ genreId, count: Math.round(count * 10) / 10 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      },

      isEpisodeCompleted: (tmdbId, season, episode) => {
        const key = makeKey(tmdbId, season, episode);
        return get().entries[key]?.completed ?? false;
      },

      clearEntry: (key) => {
        set((state) => {
          const entries = { ...state.entries };
          delete entries[key];
          return { entries };
        });

        const user = useAuthStore.getState().user;
        if (user && supabase) {
          supabase.from('watch_history').delete()
            .match({ user_id: user.id, key })
            .then(({ error }) => {
              if (error) console.error("Sync delete failed:", error);
            });
        }
      },

      clearAll: () => set({ entries: {}, telemetryBuffer: [] }),

      // ── Telemetry buffer (batched, sent to HF backend) ──
      recordProviderPerformance: (perf) => {
        set((state) => ({
          telemetryBuffer: [
            ...state.telemetryBuffer.slice(-200),  // Keep last 200
            { ...perf, timestamp: Date.now() },
          ],
        }));
      },

      flushTelemetry: () => {
        const buffer = get().telemetryBuffer;
        set({ telemetryBuffer: [] });
        return buffer;
      },

      initSync: async (userId: string) => {
        if (!supabase) return;
        try {
          const { data, error } = await supabase
            .from('watch_history')
            .select('*')
            .eq('user_id', userId);

          if (error) throw error;
          if (!data || data.length === 0) return;

          const localEntries = get().entries;
          const merged = { ...localEntries };

          for (const row of data) {
            const local = merged[row.key];
            const remoteTime = new Date(row.updated_at).getTime();

            if (!local || remoteTime > local.updatedAt) {
              merged[row.key] = {
                tmdbId: row.tmdb_id,
                mediaType: row.media_type as 'movie' | 'tv',
                title: row.title,
                posterPath: row.poster_path,
                backdropPath: row.backdrop_path,
                season: row.season,
                episode: row.episode,
                progress: row.progress,
                currentTime: row.current_time,
                duration: row.duration,
                genreIds: row.genre_ids || [],
                category: row.category,
                completed: row.completed,
                updatedAt: remoteTime,
              };
            }
          }

          set({ entries: merged });
        } catch (err) {
          console.error("Failed to sync watch history from Supabase:", err);
        }
      },
    }),
    {
      name: 'atmos-watch-state',
      storage: createJSONStorage(() => localStorage),
      // Only persist entries, not the telemetry buffer
      partialize: (state) => ({
        entries: state.entries,
      }),
      version: 1,
    }
  )
);
