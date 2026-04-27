"use client";

// ═══════════════════════════════════════════════════════════════════════
// ATMOS V3.0 — StreamPlayer: 2-Tier Hybrid Playback Engine
// ═══════════════════════════════════════════════════════════════════════
// Tier 1: NativePlayer via extracted HLS/MP4 stream (ad-free, full control)
// Tier 2: IframePlayer fallback (instant, broad compat)
//
// Race: HF Space extraction runs in parallel with 4s iframe countdown.
// If extraction wins first → NativePlayer. If iframe shown first but
// extraction later succeeds → banner prompt to switch to native.
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useCallback } from 'react';
import IframePlayer from './IframePlayer';
import NativePlayer from './NativePlayer';
import { useStreamResolver } from '@/hooks/useStreamResolver';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X } from 'lucide-react';

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
  // GDrive direct play (bypasses extraction entirely)
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
  onNextEpisode,
}: StreamPlayerProps) {
  const [useNative, setUseNative] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const { stream, isResolving, fallbackToIframe, nativeReady, forceFallback, dismissNative } =
    useStreamResolver({ tmdbId, mediaType, season, episode, timeoutMs: 4000 });

  const handleSwitchToNative = useCallback(() => {
    setUseNative(true);
    setBannerDismissed(false);
  }, []);

  const handleDismissBanner = useCallback(() => {
    setBannerDismissed(true);
    dismissNative();
  }, [dismissNative]);

  // ── Direct native (extraction won before iframe timeout) ──
  if (stream && !fallbackToIframe && !useNative === false || (stream && useNative)) {
    return (
      <NativePlayer
        stream={stream}
        tmdbId={tmdbId}
        mediaType={mediaType}
        season={season}
        episode={episode}
        onNextEpisode={onNextEpisode}
        onFallback={forceFallback}
      />
    );
  }

  // ── Loading spinner (extraction in progress, iframe not yet shown) ──
  if (isResolving && !fallbackToIframe) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-5">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-white/5" />
            <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
            <div
              className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin"
              style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}
            />
          </div>
          <p className="text-white/60 text-sm">Extracting HD stream…</p>
        </div>
      </div>
    );
  }

  // ── Iframe fallback (+ optional "Switch to Native" banner) ──
  return (
    <div className="relative w-full h-full">
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

      {/* Late-win banner: native stream arrived after iframe already showing */}
      <AnimatePresence>
        {nativeReady && !bannerDismissed && stream && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-black/80 backdrop-blur-xl border border-violet-500/30 shadow-2xl shadow-violet-900/30"
          >
            <Zap size={16} className="text-violet-400 flex-shrink-0" />
            <p className="text-white/80 text-sm font-medium">
              Ad-free HD stream ready
            </p>
            <button
              onClick={handleSwitchToNative}
              className="px-3 py-1.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
            >
              Switch
            </button>
            <button
              onClick={handleDismissBanner}
              className="text-white/40 hover:text-white/70 transition-colors"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
