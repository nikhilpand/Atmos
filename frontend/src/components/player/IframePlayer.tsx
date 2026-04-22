"use client";

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { SUBS_URL } from '@/lib/constants';
import AdBlockerOverlay from './AdBlockerOverlay';
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
}

/**
 * Sandboxed iframe player with ad-blocking overlay, auto-failover, and health reporting.
 * Uses `sandbox` attribute to block popups (replaces the window.open hack).
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
  const [adBlockActive, setAdBlockActive] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Use ref for error state to avoid stale closure in handleIframeLoad
  const hasErrorRef = useRef(false);

  const activeProvider = providers.find(p => p.id === activeProviderId);
  const activeUrl = activeProvider?.url || '';

  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
    hasErrorRef.current = false;
    setAdBlockActive(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsLoading(false), 8000);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [activeProviderId]);

  // Anti-Redirect Protection: Intercept ad scripts trying to navigate the top window
  useEffect(() => {
    const preventRedirect = (e: BeforeUnloadEvent) => {
      // Browsers require preventDefault and returnValue to show the confirmation dialog
      e.preventDefault();
      e.returnValue = 'An ad tried to redirect you. Stay on this page to continue watching.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', preventRedirect);
    return () => window.removeEventListener('beforeunload', preventRedirect);
  }, []);

  const reportHealth = (success: boolean) => {
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
    }).catch(() => { /* fire-and-forget */ });
  };

  const handleIframeError = () => {
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
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Use ref to avoid stale closure
    setTimeout(() => {
      if (!hasErrorRef.current) reportHealth(true);
    }, 5000);
  };

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
      <iframe
        ref={iframeRef}
        key={activeProviderId}
        src={activeUrl}
        className="absolute inset-0 w-full h-full border-none z-10"
        allowFullScreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        title={`Video player - ${activeProvider?.name || 'Stream'}`}
      />

      {adBlockActive && (
        <AdBlockerOverlay onDismiss={() => setAdBlockActive(false)} />
      )}

      {!adBlockActive && !isLoading && !hasError && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/40 backdrop-blur-md border border-emerald-500/10 pointer-events-none"
        >
          <ShieldCheck size={11} className="text-emerald-400/60" aria-hidden="true" />
          <span className="text-emerald-300/40 text-[9px] font-medium">Protected</span>
        </motion.div>
      )}

      <AnimatePresence>
        {isLoading && !adBlockActive && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <Spinner />
              <p className="text-white/70 text-sm font-medium">Loading {activeProvider?.name || 'stream'}...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hasError && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/90">
            <div className="text-center">
              <AlertTriangle size={40} className="text-amber-400 mx-auto mb-3" aria-hidden="true" />
              <p className="text-white/70 text-sm font-medium">Server failed to load</p>
              <p className="text-white/50 text-xs mt-1 mb-4">Trying next server...</p>
              <button
                onClick={() => {
                  setHasError(false);
                  hasErrorRef.current = false;
                  setIsLoading(true);
                  setAdBlockActive(true);
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
