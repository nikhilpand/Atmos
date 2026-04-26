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

import React, { useCallback } from 'react';
import { CONTROL_URL } from '@/lib/constants';
import IframePlayer from './IframePlayer';
import NativePlayer from './NativePlayer';
import { useStreamResolver } from '@/hooks/useStreamResolver';

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

  // ─── Tier 1 & 2: Native vs Iframe Race ────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { stream, fallbackToIframe, forceFallback } = useStreamResolver({
    tmdbId,
    mediaType,
    season,
    episode,
    timeoutMs: 4000
  });

  // Native mode (stream found and no forced fallback)
  if (stream && !fallbackToIframe) {
    return (
      <NativePlayer
        stream={stream}
        title={fileName}
        tmdbId={tmdbId}
        mediaType={mediaType}
        season={season}
        episode={episode}
        onNextEpisode={onNextEpisode}
        onFallback={forceFallback}
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
