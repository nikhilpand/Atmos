"use client";

import { useState, useEffect, useRef } from 'react';
import { extractStream, type ExtractedStream } from '@/lib/extractor';

interface UseStreamResolverProps {
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  timeoutMs?: number;
}

export function useStreamResolver({ tmdbId, mediaType, season, episode, timeoutMs = 5000 }: UseStreamResolverProps) {
  const [stream, setStream] = useState<ExtractedStream | null>(null);
  const [isResolving, setIsResolving] = useState(true);
  const [fallbackToIframe, setFallbackToIframe] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!tmdbId) {
      setFallbackToIframe(true);
      setIsResolving(false);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStream(null);
    setIsResolving(true);
    setFallbackToIframe(false);

    // Cache Key
    const cacheKey = `atmos:stream:${tmdbId}:${mediaType}:${season || 0}:${episode || 0}`;

    // 1. Check Session Storage (instant load)
    try {
      const cachedStr = sessionStorage.getItem(cacheKey);
      if (cachedStr) {
        const cachedData = JSON.parse(cachedStr);
        // Only use if less than 2 hours old
        if (Date.now() - cachedData.timestamp < 2 * 60 * 60 * 1000) {
          setStream(cachedData.stream);
          setIsResolving(false);
          return;
        }
      }
    } catch { /* ignore cache errors */ }

    // 2. Start Race: Extraction vs Timeout
    let iframeTimer: NodeJS.Timeout;

    // After timeoutMs, show iframe as fallback (extraction continues in background)
    iframeTimer = setTimeout(() => {
      if (!controller.signal.aborted && isResolving) {
        setFallbackToIframe(true);
      }
    }, timeoutMs);

    // Run extraction
    extractStream(tmdbId, mediaType || 'movie', season, episode, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        clearTimeout(iframeTimer);

        if (result.success && result.stream) {
          setStream(result.stream);
          setFallbackToIframe(false); // Can be restored if iframe was showing

          // Save to session storage
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({
              timestamp: Date.now(),
              stream: result.stream
            }));
          } catch { /* ignore quota errors */ }
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
  }, [tmdbId, mediaType, season, episode, timeoutMs]);

  const forceFallback = () => setFallbackToIframe(true);

  return { stream, isResolving, fallbackToIframe, forceFallback };
}
