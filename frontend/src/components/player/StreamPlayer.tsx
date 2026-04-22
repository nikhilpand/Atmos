"use client";

// ─── ATMOS V2.0 — Unified StreamPlayer ──────────────────────────────
// Orchestrates 3-tier playback: GDrive → HLS extraction → iframe fallback.
// Uses extracted hooks/components for clean SRP.

import React from 'react';
import { motion } from 'framer-motion';
import { CONTROL_URL } from '@/lib/constants';
import NativeVideoPlayer from './NativeVideoPlayer';
import IframePlayer from './IframePlayer';
import Spinner from '@/components/ui/Spinner';
import { useStreamExtraction } from './hooks/useStreamExtraction';

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
  // Only run extraction for TMDB titles without a fileId
  const extraction = useStreamExtraction({
    tmdbId,
    mediaType,
    season,
    episode,
    enabled: !!tmdbId && !fileId,
  });

  // ─── Tier 1: GDrive direct stream ────────────────────────────
  if (fileId) {
    const streamUrl = `${CONTROL_URL}/api/stream/${fileId}`;
    return (
      <NativeVideoPlayer
        src={streamUrl}
        title={fileName}
        onNextEpisode={onNextEpisode}
      />
    );
  }

  // ─── Tier 2: HLS extraction succeeded ────────────────────────
  if (extraction.status === 'success' && extraction.url) {
    return (
      <NativeVideoPlayer
        src={extraction.url}
        isHls={true}
        title={fileName}
        onFatalError={() => {
          // Fall through to iframe tier — handled by parent re-render
        }}
        onNextEpisode={onNextEpisode}
      />
    );
  }

  // ─── Loading: extraction in progress ─────────────────────────
  if (extraction.status === 'loading') {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-5">
          <Spinner />
          <motion.p
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            transition={{ repeat: Infinity, duration: 1, repeatType: "reverse" }}
            className="text-white/60 text-sm font-medium tracking-wide"
          >
            {extraction.log}
          </motion.p>
          {extraction.quality && (
            <span className="text-white/30 text-xs">{extraction.quality}</span>
          )}
        </div>
      </div>
    );
  }

  // ─── Tier 3: Iframe fallback ─────────────────────────────────
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
