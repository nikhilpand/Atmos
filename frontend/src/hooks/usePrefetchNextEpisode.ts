"use client";

import { useEffect } from 'react';
import { extractStream } from '@/lib/extractor';

interface PrefetchProps {
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  currentEpisode?: number;
  enabled?: boolean;
}

/**
 * Silently extracts the NEXT episode's stream in the background.
 * Caches it in sessionStorage so when the user clicks "Next Episode" or auto-plays,
 * the stream resolves instantly (0ms cold start).
 */
export function usePrefetchNextEpisode({
  tmdbId,
  mediaType,
  season,
  currentEpisode,
  enabled = true
}: PrefetchProps) {
  useEffect(() => {
    // Only prefetch TV shows if we know the current episode
    if (!enabled || !tmdbId || mediaType !== 'tv' || season === undefined || currentEpisode === undefined) {
      return;
    }

    const nextEpisode = currentEpisode + 1;
    const cacheKey = `atmos:stream:${tmdbId}:tv:${season}:${nextEpisode}`;

    // Don't prefetch if we already have it in cache
    try {
      const existing = sessionStorage.getItem(cacheKey);
      if (existing) {
        const data = JSON.parse(existing);
        if (Date.now() - data.timestamp < 2 * 60 * 60 * 1000) return; // Still valid
      }
    } catch { /* ignore */ }

    // Wait 5 seconds before starting prefetch so we don't steal bandwidth from the current stream buffering
    const timeoutId = setTimeout(() => {
      const controller = new AbortController();
      
      extractStream(tmdbId, 'tv', season, nextEpisode, controller.signal)
        .then(result => {
          if (result.success && result.stream && !controller.signal.aborted) {
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify({
                timestamp: Date.now(),
                stream: result.stream
              }));
              console.log(`[Prefetch] Successfully pre-resolved S${season} E${nextEpisode}`);
            } catch { /* quota exceeded */ }
          }
        })
        .catch(() => { /* silent fail */ });
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [tmdbId, mediaType, season, currentEpisode, enabled]);
}
