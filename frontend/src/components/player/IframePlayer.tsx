"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { SUBS_URL } from '@/lib/constants';
import Spinner from '@/components/ui/Spinner';

// The Cloudflare proxy URL — all embeds are routed through this
const CF_PROXY = process.env.NEXT_PUBLIC_CF_PROXY_URL || 'https://atmos-proxy.nkp9450732628.workers.dev';

interface IframePlayerProps {
  providers: { id: string; name: string; url: string; priority: number }[];
  activeProviderId: string;
  onProviderChange: (id: string) => void;
  onProviderError: (id: string) => void;
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

/**
 * ATMOS V5.0 — Hardened IframePlayer
 * 
 * Defense layers (NO sandbox — it's detectable):
 * 1. ALL embed URLs routed through Cloudflare proxy (?embed=URL)
 * 2. Proxy injects undetectable JS overrides (popup kill, nav lock, ad strip)
 * 3. Proxy rewrites all resource URLs to flow through itself
 * 4. Transparent click shield absorbs first click, then self-destructs
 * 5. beforeunload handler as final safety net
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
}: IframePlayerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [clickShieldActive, setClickShieldActive] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasErrorRef = useRef(false);

  const activeProvider = providers.find(p => p.id === activeProviderId);
  const rawUrl = activeProvider?.url || '';

  // Route through Cloudflare proxy — this is the key bypass
  // The proxy fetches the embed page, strips ads, injects protection JS
  const activeUrl = useMemo(() => {
    if (!rawUrl) return '';
    // If already going through our proxy, don't double-wrap
    if (rawUrl.includes(CF_PROXY) || rawUrl.includes('atmos-proxy')) return rawUrl;
    return `${CF_PROXY}?embed=${encodeURIComponent(rawUrl)}`;
  }, [rawUrl]);

  // Reset state when provider changes
  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
    hasErrorRef.current = false;
    setClickShieldActive(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsLoading(false), 8000);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [activeProviderId]);

  // Catch any top-level navigation attempts from ad scripts
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, []);

  const reportHealth = useCallback((success: boolean) => {
    if (!tmdbId || !activeProviderId) return;
    fetch(`${SUBS_URL}/provider-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tmdb_id: tmdbId, type: mediaType || 'movie',
        season: season || 0, episode: episode || 0,
        provider_id: activeProviderId, success,
      }),
    }).catch(() => {});
  }, [tmdbId, activeProviderId, mediaType, season, episode]);

  const handleIframeError = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsLoading(false);
    setHasError(true);
    hasErrorRef.current = true;
    reportHealth(false);
    onProviderError(activeProviderId);
    const idx = providers.findIndex(p => p.id === activeProviderId);
    if (idx < providers.length - 1) {
      setTimeout(() => onProviderChange(providers[idx + 1].id), 1500);
    }
  }, [activeProviderId, providers, onProviderChange, onProviderError, reportHealth]);

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setTimeout(() => { if (!hasErrorRef.current) reportHealth(true); }, 5000);
  }, [reportHealth]);

  // Click shield: absorbs first click then permanently removes itself
  const handleShieldClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setClickShieldActive(false);
  }, []);

  if (!activeUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="text-center">
          <AlertTriangle size={48} className="text-red-400 mx-auto mb-4" />
          <p className="text-white/70 text-lg font-medium">No servers available</p>
          <p className="text-white/50 text-sm mt-1">All providers are currently down</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black">
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

      {/* Click Shield — absorbs 1st click to prevent ad popup trigger */}
      {clickShieldActive && (
        <div
          onClick={handleShieldClick}
          className="absolute inset-0 z-20 cursor-pointer"
          style={{ background: 'transparent' }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-amber-500/20 pointer-events-none"
          >
            <ShieldAlert size={12} className="text-amber-400" />
            <span className="text-amber-300 text-[10px] font-medium">
              Click once to activate player
            </span>
          </motion.div>
        </div>
      )}

      {/* Protected badge */}
      {!clickShieldActive && !isLoading && !hasError && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/40 backdrop-blur-md border border-emerald-500/10 pointer-events-none"
        >
          <ShieldCheck size={11} className="text-emerald-400/60" />
          <span className="text-emerald-300/40 text-[9px] font-medium">Protected</span>
        </motion.div>
      )}

      {/* Loading overlay */}
      <AnimatePresence>
        {isLoading && !clickShieldActive && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <Spinner />
              <p className="text-white/70 text-sm font-medium">Loading {activeProvider?.name || 'stream'}...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error overlay with auto-failover */}
      <AnimatePresence>
        {hasError && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/90">
            <div className="text-center">
              <AlertTriangle size={40} className="text-amber-400 mx-auto mb-3" />
              <p className="text-white/70 text-sm font-medium">Server failed to load</p>
              <p className="text-white/50 text-xs mt-1 mb-4">Trying next server...</p>
              <button
                onClick={() => {
                  setHasError(false);
                  hasErrorRef.current = false;
                  setIsLoading(true);
                  setClickShieldActive(true);
                  if (iframeRef.current) iframeRef.current.src = activeUrl;
                }}
                className="flex items-center gap-2 px-4 py-2 mx-auto rounded-full bg-white/10 hover:bg-white/15 text-white text-sm transition-all border border-white/10"
              >
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
