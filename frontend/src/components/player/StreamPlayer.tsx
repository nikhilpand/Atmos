"use client";


// ═══════════════════════════════════════════════════════════════════════
// ATMOS V5.0 — StreamPlayer: Iframe-only Playback Engine
// ═══════════════════════════════════════════════════════════════════════
// Native HLS extraction removed — Vercel/datacenter IPs are blocked by
// all major streaming providers. The iframe approach works reliably because
// extraction runs in the provider's own infrastructure via the user's IP.
// Multi-provider failover + preloading gives sub-second switching.
// ═══════════════════════════════════════════════════════════════════════

import React from 'react';
import IframePlayer from './IframePlayer';

interface StreamPlayerProps {
  providers?: { id: string; name: string; url: string; priority: number }[];
  activeProviderId?: string;
  onProviderChange?: (id: string) => void;
  onProviderError?: (id: string) => void;
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  onNextEpisode?: () => void;
  fileId?: string;
  fileName?: string;
}

export default function StreamPlayer({
  providers = [],
  activeProviderId = '',
  onProviderChange = () => {},
  onProviderError = () => {},
  tmdbId,
  mediaType,
  season,
  episode,
}: StreamPlayerProps) {
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
