"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { SUBS_URL } from '@/lib/constants';
import { useWatchStore } from '@/store/useWatchStore';
import Spinner from '@/components/ui/Spinner';

interface IframePlayerProps {
  providers: { id: string; name: string; url: string; priority: number }[];
  activeProviderId: string;
  onProviderChange: (id: string) => void;
  onProviderError: (id: string) => void;
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  /** Content category from the resolve engine (anime, netflix, bollywood, etc.) */
  category?: string;
}

/**
 * ATMOS V6.0 — Instant iframe player with:
 * - Aggressive auto-failover (800ms)
 * - Preloads next provider in hidden iframe
 * - Provider performance telemetry (load time tracking)
 * - Watch progress tracking for Continue Watching
 */
export default function IframePlayer({
  providers,
  activeProviderId,
  onProviderChange,
  onProviderError,
  tmdbId,
  mediaType,
  season,
  episode,
  category,
}: IframePlayerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasErrorRef = useRef(false);
  const failoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadStartRef = useRef<number>(Date.now()); // Track load start for latency measurement

  const recordPerformance = useWatchStore(s => s.recordProviderPerformance);

  const activeProvider = providers.find(p => p.id === activeProviderId);
  const activeUrl = activeProvider?.url || '';

  // Get the next provider for preloading
  const activeIdx = providers.findIndex(p => p.id === activeProviderId);
  const nextProvider = activeIdx >= 0 && activeIdx < providers.length - 1
    ? providers[activeIdx + 1] : null;

  // ── Reset state on provider change ──
  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
    hasErrorRef.current = false;
    loadStartRef.current = Date.now(); // Reset load timer

    // Clear existing timers
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (failoverTimerRef.current) clearTimeout(failoverTimerRef.current);

    // 6s hard timeout — if iframe hasn't loaded, auto-failover
    timeoutRef.current = setTimeout(() => {
      if (hasErrorRef.current) return; // already handled
      setIsLoading(false);
      // Don't set error — the iframe might still be loading content internally
      // Just hide the spinner so user sees the iframe
    }, 6000);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (failoverTimerRef.current) clearTimeout(failoverTimerRef.current);
    };
  }, [activeProviderId]);

  // ── VidLink Watch Progress & Player Events ──
  useEffect(() => {
    const PROXY_ORIGIN = 'https://atmos-proxy.nkp9450732628.workers.dev';

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== PROXY_ORIGIN) return;

      if (event.data?.type === 'MEDIA_DATA') {
        try {
          localStorage.setItem('vidLinkProgress', JSON.stringify(event.data.data));
        } catch { /* ignore */ }
      }

      if (event.data?.type === 'PLAYER_EVENT') {
        const { event: eventType, currentTime, duration } = event.data.data;
        if (eventType === 'timeupdate' && duration > 0) {
          const progressPct = Math.round((currentTime / duration) * 100);
          window.dispatchEvent(new CustomEvent('atmos:progress', {
            detail: { tmdbId, mediaType, season, episode, progress: progressPct, currentTime, duration }
          }));
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [tmdbId, mediaType, season, episode]);

  // ── Fire-and-forget health report ──
  const reportHealth = useCallback((success: boolean) => {
    if (!tmdbId || !activeProviderId) return;
    fetch(`${SUBS_URL}/provider-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tmdb_id: tmdbId,
        type: mediaType || 'movie',
        season: season || 0,
        episode: episode || 0,
        provider_id: activeProviderId,
        success,
      }),
    }).catch(() => {});
  }, [tmdbId, activeProviderId, mediaType, season, episode]);

  const handleIframeError = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsLoading(false);
    setHasError(true);
    hasErrorRef.current = true;
    reportHealth(false);

    // Record failure telemetry
    if (tmdbId && activeProviderId) {
      const latencyMs = Date.now() - loadStartRef.current;
      recordPerformance({
        providerId: activeProviderId,
        tmdbId,
        category: category || 'general',
        success: false,
        latencyMs,
      });
    }

    onProviderError(activeProviderId);

    // Auto-failover to next provider in 800ms
    const idx = providers.findIndex(p => p.id === activeProviderId);
    if (idx < providers.length - 1) {
      failoverTimerRef.current = setTimeout(() => onProviderChange(providers[idx + 1].id), 800);
    }
  }, [activeProviderId, providers, onProviderChange, onProviderError, reportHealth, tmdbId, category, recordPerformance]);

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // Record success telemetry with measured latency
    if (tmdbId && activeProviderId) {
      const latencyMs = Date.now() - loadStartRef.current;
      recordPerformance({
        providerId: activeProviderId,
        tmdbId,
        category: category || 'general',
        success: true,
        latencyMs,
      });
    }

    // Delayed success report to HF backend (don't block render)
    setTimeout(() => {
      if (!hasErrorRef.current) reportHealth(true);
    }, 3000);
  }, [reportHealth, tmdbId, activeProviderId, category, recordPerformance]);

  if (!activeUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="text-center">
          <AlertTriangle size={48} className="text-red-400 mx-auto mb-4" aria-hidden="true" />
          <p className="text-white/70 text-lg font-medium">No servers available</p>
          <p className="text-white/50 text-sm mt-1">All providers are currently down</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black">
      {/* Main iframe — NO sandbox, loads instantly */}
      <iframe
        ref={iframeRef}
        key={activeProviderId}
        src={activeUrl}
        className="absolute inset-0 w-full h-full border-none z-10"
        allowFullScreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        referrerPolicy="no-referrer"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        title={`Video player - ${activeProvider?.name || 'Stream'}`}
      />

      {/* Preload next provider iframe (hidden, 0x0) for instant failover */}
      {nextProvider && (
        <iframe
          src={nextProvider.url}
          className="absolute w-0 h-0 border-none opacity-0 pointer-events-none"
          tabIndex={-1}
          aria-hidden="true"
          title="Preload next server"
        />
      )}

      {/* Protected badge — shows after load, no overlay delay */}
      {!isLoading && !hasError && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/40 backdrop-blur-md border border-emerald-500/10 pointer-events-none"
        >
          <ShieldCheck size={11} className="text-emerald-400/60" aria-hidden="true" />
          <span className="text-emerald-300/40 text-[9px] font-medium">Protected</span>
        </motion.div>
      )}

      {/* Loading spinner — minimal, no ad-blocker overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <Spinner />
              <p className="text-white/70 text-sm font-medium">Loading {activeProvider?.name || 'stream'}...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error state with auto-failover */}
      <AnimatePresence>
        {hasError && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/90">
            <div className="text-center">
              <AlertTriangle size={40} className="text-amber-400 mx-auto mb-3" aria-hidden="true" />
              <p className="text-white/70 text-sm font-medium">Server failed to load</p>
              <p className="text-white/50 text-xs mt-1 mb-4">Switching to next server...</p>
              <button
                onClick={() => {
                  setHasError(false);
                  hasErrorRef.current = false;
                  setIsLoading(true);
                  if (iframeRef.current) iframeRef.current.src = activeUrl;
                }}
                className="flex items-center gap-2 px-4 py-2 mx-auto rounded-full bg-white/10 hover:bg-white/15 text-white text-sm transition-all border border-white/10"
                aria-label="Retry loading video"
              >
                <RefreshCw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
