"use client";

// ─── ATMOS V2.0 — Watch Progress Hook ──────────────────────────────
// Persists playback position to localStorage with debounced saves.
// Resumes where you left off on any title.

import { useCallback, useEffect, useRef } from 'react';

interface UseWatchProgressOptions {
  tmdbId: string;
  episodeKey?: string; // e.g. "s1e3" for TV
}

function getStorageKey(tmdbId: string, episodeKey?: string): string {
  return episodeKey
    ? `atmos:progress:${tmdbId}:${episodeKey}`
    : `atmos:progress:${tmdbId}`;
}

export function useWatchProgress({ tmdbId, episodeKey }: UseWatchProgressOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(0);

  const key = getStorageKey(tmdbId, episodeKey);

  // Load saved progress
  const load = useCallback((): number => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const val = parseFloat(raw);
        // Don't resume if less than 10s or more than 95% through
        return isNaN(val) ? 0 : val;
      }
    } catch {
      // localStorage unavailable
    }
    return 0;
  }, [key]);

  // Save progress (debounced — writes at most every 5s)
  const save = useCallback((currentTime: number, duration: number) => {
    if (!duration || duration < 60) return; // Don't track very short content

    // Don't save if we're at the very start or very end
    const pct = currentTime / duration;
    if (pct < 0.02 || pct > 0.95) return;

    const now = Date.now();
    if (now - lastSaved.current < 5000) return; // Debounce 5s

    lastSaved.current = now;
    try {
      localStorage.setItem(key, String(Math.floor(currentTime)));
    } catch {
      // localStorage full or unavailable
    }
  }, [key]);

  // Mark as completed (remove progress)
  const markComplete = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, [key]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { load, save, markComplete };
}
