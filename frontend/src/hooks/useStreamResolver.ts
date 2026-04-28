"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { type ExtractedStream } from '@/lib/extractor';

interface UseStreamResolverProps {
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  timeoutMs?: number;   // ms before showing iframe fallback (default 4s)
}

/**
 * ATMOS V4 — Stream resolver.
 *
 * Architecture fix: calls the HF Space extractor DIRECTLY from the browser,
 * bypassing the Vercel /api/extract route which was being flagged as a bot
 * by streaming providers.
 *
 * Race: direct HF call vs. 4s iframe timeout.
 * Late win: if HF returns stream AFTER iframe is shown, swaps seamlessly to NativePlayer.
 */

// Direct HF Space URL — bypasses Vercel (no bot-flagged datacenter IP)
const HF_EXTRACTOR = process.env.NEXT_PUBLIC_EXTRACTOR_URL
  || 'https://nikhil1776-atmos-extractor.hf.space';

// Session-level cache
const sessionCache = new Map<string, { stream: ExtractedStream; ts: number }>();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Safely merges two AbortSignals without relying on AbortSignal.any(),
 * which is unavailable in older Safari and some Vercel edge runtimes.
 */
function mergeSignals(a: AbortSignal, b: AbortSignal): AbortController {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (a.aborted || b.aborted) { controller.abort(); return controller; }
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return controller;
}

async function fetchStreamDirect(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  signal?: AbortSignal,
): Promise<ExtractedStream | null> {
  const params = new URLSearchParams({ id: tmdbId, type });
  if (season !== undefined) params.set('season', String(season));
  if (episode !== undefined) params.set('episode', String(episode));

  // 32-second client timeout
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), 32_000);

  // Safe cross-runtime signal merge (no AbortSignal.any)
  const merged = signal
    ? mergeSignals(signal, timeoutController.signal)
    : timeoutController;

  try {
    const res = await fetch(`${HF_EXTRACTOR}/extract/tmdb?${params}`, {
      signal: merged.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Atmos/4.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || !data.stream?.url) return null;
    return {
      type: data.stream.type === 'hls' ? 'hls' : 'file',
      url: data.stream.url,
      headers: data.stream.headers || {},
      quality: data.stream.quality,
      qualities: data.stream.qualities,
      captions: data.stream.captions,
      sourceId: data.stream.provider,
      embedId: data.stream.providerName,
    } satisfies ExtractedStream;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export function useStreamResolver({
  tmdbId,
  mediaType,
  season,
  episode,
  timeoutMs = 4000,
}: UseStreamResolverProps) {
  const [stream, setStream] = useState<ExtractedStream | null>(null);
  const [isResolving, setIsResolving] = useState(true);
  // fallbackToIframe: show iframe while we wait (or permanently on failure)
  const [fallbackToIframe, setFallbackToIframe] = useState(false);
  // nativeReady: extraction succeeded AFTER iframe was shown — swap to native
  const [nativeReady, setNativeReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const forceFallback = useCallback(() => setFallbackToIframe(true), []);
  const dismissNative = useCallback(() => setNativeReady(false), []);

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
    setNativeReady(false);

    // Session cache check
    const key = `atmos:${tmdbId}:${mediaType}:${season ?? 0}:${episode ?? 0}`;
    const cached = sessionCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setStream(cached.stream);
      setIsResolving(false);
      return;
    }

    // After timeoutMs: show iframe so user isn't staring at spinner
    const iframeTimer = setTimeout(() => {
      if (!controller.signal.aborted) setFallbackToIframe(true);
    }, timeoutMs);

    // Kick off direct HF extraction (runs in parallel with iframe countdown)
    fetchStreamDirect(tmdbId, mediaType || 'movie', season, episode, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        clearTimeout(iframeTimer);

        if (result) {
          sessionCache.set(key, { stream: result, ts: Date.now() });
          setStream(result);

          // If iframe is already showing, signal a swap to native
          setFallbackToIframe(prev => {
            if (prev) {
              // Iframe is showing — flag native as ready, parent decides when to swap
              setNativeReady(true);
              return true; // keep iframe for now, parent will swap
            }
            return false; // still in loading phase, go directly to native
          });
        } else {
          setFallbackToIframe(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFallbackToIframe(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsResolving(false);
      });

    return () => {
      controller.abort();
      clearTimeout(iframeTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId, mediaType, season, episode, timeoutMs]);

  return { stream, isResolving, fallbackToIframe, nativeReady, forceFallback, dismissNative };
}
