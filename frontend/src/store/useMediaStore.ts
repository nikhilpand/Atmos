import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ─── Types ──────────────────────────────────────────────────────────
interface WatchHistoryItem {
  id: number;
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  watchedAt: number; // timestamp
  progress?: number; // 0-100
  season?: number;
  episode?: number;
}

interface WatchlistItem {
  id: number;
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  addedAt: number;
}

interface UserState {
  isAuthenticated: boolean;
  username: string | null;
  id?: string | null;
  token?: string | null;
}

interface MediaState {
  // ─── UI State ───────────────────────────
  hoverColor: string | null;
  setHoverColor: (color: string | null) => void;

  activeStreamUrl: string | null;
  setActiveStreamUrl: (url: string | null) => void;

  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;

  // ─── User Auth ──────────────────────────
  user: UserState;
  login: (username: string, password?: string) => Promise<void>;
  logout: () => void;

  // ─── Watch History ──────────────────────
  watchHistory: WatchHistoryItem[];
  addToHistory: (item: Omit<WatchHistoryItem, 'watchedAt'>) => void;
  removeFromHistory: (tmdbId: number) => void;
  clearHistory: () => void;
  getHistoryItem: (tmdbId: number) => WatchHistoryItem | undefined;

  // ─── Watchlist ──────────────────────────
  watchlist: WatchlistItem[];
  addToWatchlist: (item: Omit<WatchlistItem, 'addedAt'>) => Promise<void>;
  removeFromWatchlist: (tmdbId: number) => Promise<void>;
  isInWatchlist: (tmdbId: number) => boolean;
  toggleWatchlist: (item: Omit<WatchlistItem, 'addedAt'>) => Promise<void>;

  // ─── Provider Preferences ──────────────
  preferredProvider: string | null;
  setPreferredProvider: (id: string | null) => void;
  lastUsedProviders: Record<string, string>; // tmdbId -> providerId
  setLastUsedProvider: (tmdbId: string, providerId: string) => void;
}

export const useMediaStore = create<MediaState>()(
  persist(
    (set, get) => ({
      // ─── UI State ───────────────────────────
      hoverColor: null,
      setHoverColor: (color) => set({ hoverColor: color }),

      activeStreamUrl: null,
      setActiveStreamUrl: (url) => set({ activeStreamUrl: url }),

      isPlaying: false,
      setIsPlaying: (playing) => set({ isPlaying: playing }),

      // ─── User Auth ──────────────────────────
      user: { isAuthenticated: false, username: null, id: null, token: null },
      login: async (username, password = 'defaultPassword123') => {
        try {
          const res = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });
          const data = await res.json();
          
          if (data.success) {
            const userId = data.user.id || data.user.username;
            set({ user: { isAuthenticated: true, username: data.user.username, id: userId, token: data.token } });
            
            // Sync watchlist from backend
            try {
              const wlRes = await fetch(`/api/watchlist?userId=${userId}`);
              const wlData = await wlRes.json();
              if (wlData.items && Array.isArray(wlData.items)) {
                const mapped = wlData.items.map((i: { tmdb_id: number; media_type: 'movie' | 'tv'; title: string; poster_path?: string; added_at: string }) => ({
                  id: i.tmdb_id, // fallback for legacy id
                  tmdbId: i.tmdb_id,
                  type: i.media_type,
                  title: i.title,
                  posterPath: i.poster_path,
                  addedAt: new Date(i.added_at).getTime()
                }));
                set({ watchlist: mapped });
              }
            } catch (e) {
              console.error('Failed to sync watchlist on login', e);
            }
          } else {
            console.error('Login failed:', data.error);
            // Fallback for demo
            set({ user: { isAuthenticated: true, username, id: username } });
          }
        } catch (error) {
          console.error('Login error:', error);
          set({ user: { isAuthenticated: true, username, id: username } });
        }
      },
      logout: () => set({
        user: { isAuthenticated: false, username: null, id: null, token: null },
        watchlist: [],
        watchHistory: [],
      }),

      // ─── Watch History ──────────────────────
      watchHistory: [],
      addToHistory: (item) => set((state) => {
        // Remove existing entry for this title, then add at front
        const filtered = state.watchHistory.filter(h => h.tmdbId !== item.tmdbId);
        return {
          watchHistory: [
            { ...item, watchedAt: Date.now() },
            ...filtered,
          ].slice(0, 100), // Keep last 100
        };
      }),
      removeFromHistory: (tmdbId) => set((state) => ({
        watchHistory: state.watchHistory.filter(h => h.tmdbId !== tmdbId),
      })),
      clearHistory: () => set({ watchHistory: [] }),
      getHistoryItem: (tmdbId) => get().watchHistory.find(h => h.tmdbId === tmdbId),

      // ─── Watchlist ──────────────────────────
      watchlist: [],
      addToWatchlist: async (item) => {
        const state = get();
        if (state.watchlist.some(w => w.tmdbId === item.tmdbId)) return;
        
        // Optimistic update
        set({
          watchlist: [{ ...item, addedAt: Date.now() }, ...state.watchlist],
        });

        if (state.user.isAuthenticated && state.user.id) {
          try {
            await fetch('/api/watchlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: state.user.id,
                tmdbId: item.tmdbId,
                type: item.type,
                title: item.title,
                posterPath: item.posterPath
              })
            });
          } catch (e) {
            console.error('Failed to sync watchlist add', e);
          }
        }
      },
      removeFromWatchlist: async (tmdbId) => {
        const state = get();
        // Optimistic update
        set({
          watchlist: state.watchlist.filter(w => w.tmdbId !== tmdbId),
        });

        if (state.user.isAuthenticated && state.user.id) {
          try {
            await fetch(`/api/watchlist?userId=${state.user.id}&tmdbId=${tmdbId}`, {
              method: 'DELETE'
            });
          } catch (e) {
            console.error('Failed to sync watchlist remove', e);
          }
        }
      },
      isInWatchlist: (tmdbId) => get().watchlist.some(w => w.tmdbId === tmdbId),
      toggleWatchlist: async (item) => {
        const state = get();
        if (state.watchlist.some(w => w.tmdbId === item.tmdbId)) {
          await state.removeFromWatchlist(item.tmdbId);
        } else {
          await state.addToWatchlist(item);
        }
      },

      // ─── Provider Preferences ──────────────
      preferredProvider: null,
      setPreferredProvider: (id) => set({ preferredProvider: id }),
      lastUsedProviders: {},
      setLastUsedProvider: (tmdbId, providerId) => set((state) => ({
        lastUsedProviders: { ...state.lastUsedProviders, [tmdbId]: providerId },
      })),
    }),
    {
      name: 'atmos-media-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist user data, not transient UI state
        user: state.user,
        watchHistory: state.watchHistory,
        watchlist: state.watchlist,
        preferredProvider: state.preferredProvider,
        lastUsedProviders: state.lastUsedProviders,
      }),
    }
  )
);
