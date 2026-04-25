"use client";

// ═══════════════════════════════════════════════════════════════════════
// ATMOS V2.0 — StreamPlayer: 3-Tier Hybrid Playback Engine
// ═══════════════════════════════════════════════════════════════════════
// Strategy:
//   Tier 0: GDrive direct stream (personal library)
//   Tier 1: Native player via extracted stream (ad-free, downloadable)
//   Tier 2: Iframe player fallback (broad compatibility)
//
// The extraction attempt runs in parallel with iframe preloading.
// If extraction succeeds, we show the native player.
// If it fails or times out, we seamlessly fall back to iframe.
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CONTROL_URL } from '@/lib/constants';
import { extractStream, type ExtractedStream } from '@/lib/extractor';
import IframePlayer from './IframePlayer';
import NativePlayer from './NativePlayer';

interface StreamPlayerProps {
  fileId?: string;
  fileName?: string;
  providers?: { id: string; name: string; url: string; priority: number }[];
  activeProviderId?: string;
  onProviderChange?: (id: string) => void;
  onProviderError?: (id: string) => void;
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  onNextEpisode?: () => void;
}

type PlayerMode = 'loading' | 'native' | 'iframe';

export default function StreamPlayer({
  fileId,
  fileName,
  providers = [],
  activeProviderId = '',
  onProviderChange = () => {},
  onProviderError = () => {},
  tmdbId,
  mediaType,
  season,
  episode,
  onNextEpisode,
}: StreamPlayerProps) {
  const [mode, setMode] = useState<PlayerMode>('loading');
  const [extractedStream, setExtractedStream] = useState<ExtractedStream | null>(null);
  const [extractionFailed, setExtractionFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ─── Tier 0: GDrive direct stream (instant) ──────────────────────
  if (fileId) {
    const streamUrl = `${CONTROL_URL}/api/stream/${fileId}`;
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <video
          src={streamUrl}
          controls
          autoPlay
          className="w-full h-full object-contain"
          onEnded={onNextEpisode}
        />
      </div>
    );
  }

  // ─── Tier 1: Attempt native extraction ────────────────────────────
  // We use a parallel strategy: start extraction immediately, but
  // if it takes > 3s, show the iframe player while extraction continues.
  // If extraction succeeds later, the user can switch to native.

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!tmdbId || extractionFailed) {
      setMode('iframe');
      return;
    }

    // Cancel previous extraction
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setMode('loading');
    setExtractedStream(null);

    let iframeTimer: NodeJS.Timeout;

    // After 4s, show iframe as fallback (extraction continues in background)
    iframeTimer = setTimeout(() => {
      if (!controller.signal.aborted) {
        setMode(prev => prev === 'loading' ? 'iframe' : prev);
      }
    }, 4000);

    // Run extraction
    extractStream(tmdbId, mediaType || 'movie', season, episode, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        clearTimeout(iframeTimer);

        if (result.success && result.stream) {
          setExtractedStream(result.stream);
          setMode('native');
        } else {
          console.warn('[StreamPlayer] Extraction failed:', result.error);
          setExtractionFailed(true);
          setMode('iframe');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setExtractionFailed(true);
          setMode('iframe');
        }
      });

    return () => {
      controller.abort();
      clearTimeout(iframeTimer);
    };
  }, [tmdbId, mediaType, season, episode, extractionFailed]);

  // ── Handle native player failure → fallback to iframe ──
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleNativeFallback = useCallback(() => {
    console.warn('[StreamPlayer] Native player failed, switching to iframe');
    setExtractionFailed(true);
    setMode('iframe');
  }, []);

  // ─── Render based on mode ─────────────────────────────────────────

  // Native mode
  if (mode === 'native' && extractedStream) {
    return (
      <NativePlayer
        stream={extractedStream}
        title={fileName}
        tmdbId={tmdbId}
        mediaType={mediaType}
        season={season}
        episode={episode}
        onNextEpisode={onNextEpisode}
        onFallback={handleNativeFallback}
      />
    );
  }

  // Iframe fallback or loading (iframe shows loading state internally)
  return (
    <IframePlayer
      providers={providers}
      activeProviderId={activeProviderId}
      onProviderChange={onProviderChange}
      onProviderError={onProviderError}
      tmdbId={tmdbId}
      mediaType={mediaType}
      season={season}
      episode={episode}
    />
  );
}
