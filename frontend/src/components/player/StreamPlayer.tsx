"use client";

// ─── ATMOS V5.0 — StreamPlayer: Instant Playback ───────────────────
// Strategy: Skip slow extraction, load iframe INSTANTLY.
// Extraction was taking 15-20s and failing 90% of the time (403s).
// Iframe providers load in <2s and have 16 fallback servers.

import React from 'react';
import { CONTROL_URL } from '@/lib/constants';
import IframePlayer from './IframePlayer';

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
  // ─── Tier 1: GDrive direct stream (instant) ──────────────────
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

  // ─── Tier 2: Iframe — instant load, 16 fallback servers ──────
  // No more extraction phase. Iframes load in <2s vs 20s extraction.
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
