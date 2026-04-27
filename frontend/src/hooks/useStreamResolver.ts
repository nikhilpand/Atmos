"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { extractStream, type ExtractedStream } from '@/lib/extractor';

interface UseStreamResolverProps {
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  timeoutMs?: number;
}

export function useStreamResolver({ tmdbId, mediaType, season, episode, timeoutMs = 4000 }: UseStreamResolverProps) {
  const [stream, setStream] = useState<ExtractedStream | null>(null);
  const [isResolving, setIsResolving] = useState(true);
  const [fallbackToIframe, setFallbackToIframe] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // No TMDB ID = instant iframe fallback
    if (!tmdbId) {
      setFallbackToIframe(true);
      setIsResolving(false);
      return;
    }

    // Abort previous extraction
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset state
    setStream(null);
    setIsResolving(true);
    setFallbackToIframe(false);

    // Check session storage cache first
    const cacheKey = `atmos:stream:${tmdbId}:${mediaType}:${season || 0}:${episode || 0}`;
    try {
      const cachedStr = sessionStorage.getItem(cacheKey);
      if (cachedStr) {
        const cachedData = JSON.parse(cachedStr);
        if (Date.now() - cachedData.timestamp < 2 * 60 * 60 * 1000) {
          setStream(cachedData.stream);
          setIsResolving(false);
          return;
        }
      }
    } catch { /* ignore */ }

    // After timeoutMs, show iframe fallback (extraction continues in background)
    const iframeTimer = setTimeout(() => {
      if (!controller.signal.aborted) {
        setFallbackToIframe(true);
      }
    }, timeoutMs);

    // Run extraction in parallel
    extractStream(tmdbId, mediaType || 'movie', season, episode, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        clearTimeout(iframeTimer);

        if (result.success && result.stream) {
          setStream(result.stream);
          setFallbackToIframe(false);

          // Cache result
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({
              timestamp: Date.now(),
              stream: result.stream,
            }));
          } catch { /* ignore */ }
        } else {
          setFallbackToIframe(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFallbackToIframe(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsResolving(false);
        }
      });

    return () => {
      controller.abort();
      clearTimeout(iframeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId, mediaType, season, episode, timeoutMs]);

  const forceFallback = useCallback(() => setFallbackToIframe(true), []);

  return { stream, isResolving, fallbackToIframe, forceFallback };
}
