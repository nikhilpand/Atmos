"use client";

// ─── ATMOS V5.0 — Stream Extraction Hook ────────────────────────────
// Primary: /api/extract-all (12-source parallel engine)
// Fallback: /api/extract (single movie-web library)
// Last resort: client-side extraction

import { useState, useEffect, useRef, useCallback } from 'react';
import { log } from '@/lib/logger';

export type ExtractionStatus = 'idle' | 'loading' | 'success' | 'failed';

export interface StreamOption {
  url: string;
  quality: string;
}

export interface ExtractionState {
  status: ExtractionStatus;
  url: string | null;
  log: string;
  quality?: string;
  provider?: string;
  allStreams: StreamOption[];
  selectedQuality: string;
  setQuality: (quality: string) => void;
}

interface UseStreamExtractionParams {
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  enabled: boolean;
}

const EXTRACTION_TIMEOUT_MS = 30_000; // 30s for 12-source engine

export function useStreamExtraction(params: UseStreamExtractionParams): ExtractionState {
  const { tmdbId, mediaType, season, episode, enabled } = params;
  const [state, setState] = useState<Omit<ExtractionState, 'setQuality'>>({
    status: enabled && tmdbId ? 'loading' : 'idle',
    url: null,
    log: 'Locating stream…',
    allStreams: [],
    selectedQuality: 'auto',
  });
  const abortRef = useRef<AbortController | null>(null);

  const setQuality = useCallback((quality: string) => {
    setState(prev => {
      const match = prev.allStreams.find(s => s.quality === quality);
      if (match) return { ...prev, url: match.url, quality: match.quality, selectedQuality: quality };
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!enabled || !tmdbId) {
      setState({ status: 'idle', url: null, log: '', allStreams: [], selectedQuality: 'auto' });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let mounted = true;

    const update = (partial: Partial<Omit<ExtractionState, 'setQuality'>>) => {
      if (mounted && !controller.signal.aborted) setState(prev => ({ ...prev, ...partial }));
    };

    async function run() {
      update({ status: 'loading', url: null, log: 'Fetching metadata…', allStreams: [], selectedQuality: 'auto' });

      const timeout = setTimeout(() => {
        controller.abort();
        update({ status: 'failed', log: 'Extraction timed out' });
      }, EXTRACTION_TIMEOUT_MS);

      try {
        // Step 1: Get title metadata
        const titleRes = await fetch(`/api/title?id=${tmdbId}&type=${mediaType || 'movie'}`, { signal: controller.signal });
        const titleData = await titleRes.json();
        const title = titleData?.detail?.title || titleData?.detail?.name;
        const releaseYearStr = titleData?.detail?.release_date || titleData?.detail?.first_air_date;
        const releaseYear = releaseYearStr ? parseInt(releaseYearStr.substring(0, 4), 10) : new Date().getFullYear();

        if (!title) { update({ status: 'failed', log: 'No title metadata found' }); return; }

        // Step 2: PRIMARY — 12-source parallel engine
        update({ log: 'Scanning 12 sources…' });

        try {
          const engineRes = await fetch('/api/extract-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tmdbId, type: mediaType || 'movie', title, releaseYear, season, episode }),
            signal: controller.signal,
          });

          if (engineRes.ok) {
            const engineData = await engineRes.json();
            if (engineData.streams && engineData.streams.length > 0) {
              const best = engineData.streams[0];
              const streams = engineData.streams.map((s: { url: string; quality: string }) => ({ url: s.url, quality: s.quality }));
              update({
                status: 'success',
                url: best.url,
                log: `Stream found via ${best.provider}`,
                quality: best.quality,
                provider: best.provider,
                allStreams: streams,
                selectedQuality: best.quality || 'auto',
              });
              log.info('[Hook] 12-source engine succeeded', { tmdbId, provider: best.provider, quality: best.quality, total: streams.length });
              return;
            }
          }
        } catch (e) {
          if (controller.signal.aborted) return;
          log.warn('[Hook] 12-source engine failed', { error: e instanceof Error ? e.message : String(e) });
        }

        // Step 3: FALLBACK — single server-side extract
        update({ log: 'Trying fallback extraction…' });

        try {
          const serverRes = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tmdbId, type: mediaType || 'movie', title, releaseYear, season, episode }),
            signal: controller.signal,
          });

          if (serverRes.ok) {
            const serverData = await serverRes.json();
            if (serverData.url) {
              const streams = serverData.allStreams || [{ url: serverData.url, quality: serverData.quality || 'auto' }];
              update({
                status: 'success', url: serverData.url, log: 'Stream found!',
                quality: serverData.quality, provider: serverData.provider,
                allStreams: streams, selectedQuality: serverData.quality || 'auto',
              });
              return;
            }
          }
        } catch (e) {
          if (controller.signal.aborted) return;
          log.warn('[Hook] Fallback extract failed', { error: e instanceof Error ? e.message : String(e) });
        }

        // Step 4: All extraction failed
        update({ status: 'failed', log: 'No direct streams found' });

      } catch (error) {
        if (controller.signal.aborted) return;
        log.error('[Hook] Extraction error', { error: error instanceof Error ? error.message : String(error) });
        update({ status: 'failed', log: 'Extraction failed' });
      } finally {
        clearTimeout(timeout);
      }
    }

    run();
    return () => { mounted = false; controller.abort(); };
  }, [tmdbId, mediaType, season, episode, enabled]);

  return { ...state, setQuality };
}
