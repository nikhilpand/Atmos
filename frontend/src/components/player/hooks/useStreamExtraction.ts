"use client";

// ─── ATMOS V2.0 — Stream Extraction Hook ────────────────────────────
// Dual-mode extraction: server-side first (reliable), client fallback.
// Includes AbortController timeout and structured state machine.

import { useState, useEffect, useRef } from 'react';
import { extractStreamClient, type MediaDetails } from '@/lib/movieWebClient';
import { log } from '@/lib/logger';

export type ExtractionStatus = 'idle' | 'loading' | 'success' | 'failed';

export interface ExtractionState {
  status: ExtractionStatus;
  url: string | null;
  log: string;
  quality?: string;
  provider?: string;
}

interface UseStreamExtractionParams {
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  enabled: boolean;
}

const EXTRACTION_TIMEOUT_MS = 20_000; // 20s hard timeout

export function useStreamExtraction(params: UseStreamExtractionParams): ExtractionState {
  const { tmdbId, mediaType, season, episode, enabled } = params;
  const [state, setState] = useState<ExtractionState>({
    status: enabled && tmdbId ? 'loading' : 'idle',
    url: null,
    log: 'Locating stream…',
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !tmdbId) {
      setState({ status: 'idle', url: null, log: '' });
      return;
    }

    // Abort previous extraction
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let mounted = true;

    const update = (partial: Partial<ExtractionState>) => {
      if (mounted && !controller.signal.aborted) {
        setState(prev => ({ ...prev, ...partial }));
      }
    };

    async function run() {
      update({ status: 'loading', url: null, log: 'Fetching metadata…' });

      // Timeout guard
      const timeout = setTimeout(() => {
        controller.abort();
        update({ status: 'failed', log: 'Extraction timed out' });
      }, EXTRACTION_TIMEOUT_MS);

      try {
        // ── Step 1: Fetch title metadata ────────────────────────
        const titleRes = await fetch(
          `/api/title?id=${tmdbId}&type=${mediaType || 'movie'}`,
          { signal: controller.signal }
        );
        const titleData = await titleRes.json();

        const title = titleData?.detail?.title || titleData?.detail?.name;
        const releaseYearStr = titleData?.detail?.release_date || titleData?.detail?.first_air_date;
        const releaseYear = releaseYearStr
          ? parseInt(releaseYearStr.substring(0, 4), 10)
          : new Date().getFullYear();

        if (!title) {
          update({ status: 'failed', log: 'No title metadata found' });
          return;
        }

        // ── Step 2: Try server-side extraction first (more reliable) ──
        update({ log: 'Extracting stream (server)…' });

        try {
          const serverRes = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tmdbId,
              type: mediaType || 'movie',
              title,
              releaseYear,
              season,
              episode,
            }),
            signal: controller.signal,
          });

          if (serverRes.ok) {
            const serverData = await serverRes.json();
            if (serverData.url) {
              update({
                status: 'success',
                url: serverData.url,
                log: 'Stream found!',
                quality: serverData.quality,
                provider: serverData.provider,
              });
              log.info('[Hook] Server extraction succeeded', { tmdbId, quality: serverData.quality });
              return;
            }
          }
        } catch (e) {
          // Server extraction failed — fall through to client
          if (controller.signal.aborted) return;
          log.warn('[Hook] Server extraction failed, trying client', {
            error: e instanceof Error ? e.message : String(e),
          });
        }

        // ── Step 3: Client-side fallback ──────────────────────────
        update({ log: 'Trying client extraction…' });

        const mediaDetails: MediaDetails = {
          type: mediaType || 'movie',
          title,
          releaseYear,
          tmdbId: tmdbId!, // guaranteed non-null by guard at hook entry
          season,
          episode,
        };

        const clientUrl = await extractStreamClient(mediaDetails);

        if (controller.signal.aborted) return;

        if (clientUrl) {
          update({
            status: 'success',
            url: clientUrl,
            log: 'Stream found!',
            quality: 'auto',
          });
        } else {
          update({ status: 'failed', log: 'No streams available' });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        log.error('[Hook] Extraction error', {
          error: error instanceof Error ? error.message : String(error),
        });
        update({ status: 'failed', log: 'Extraction failed' });
      } finally {
        clearTimeout(timeout);
      }
    }

    run();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [tmdbId, mediaType, season, episode, enabled]);

  return state;
}
