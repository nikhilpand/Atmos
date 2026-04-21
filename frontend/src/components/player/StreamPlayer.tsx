"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw, Shield, ShieldCheck } from 'lucide-react';
import { CONTROL_URL, SUBS_URL } from '@/lib/constants';
import NativeVideoPlayer from './NativeVideoPlayer';
import { extractStreamClient, MediaDetails } from '@/lib/movieWebClient';

interface StreamPlayerProps {
  // GDrive mode: direct file streaming (primary)
  fileId?: string;
  fileName?: string;
  // Provider/iframe mode: fallback for TMDB browsing (legacy)
  providers?: { id: string; name: string; url: string; priority: number }[];
  activeProviderId?: string;
  onProviderChange?: (id: string) => void;
  onProviderError?: (id: string) => void;
  // Metadata for extraction
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

// ─── Ad Blocker Shield V2 ───────────────────────────────────────────
// Absorbs the first N clicks to prevent ad popups on iframes
function AdBlockerOverlay({ onDismiss }: { onDismiss: () => void }) {
  const [clicksAbsorbed, setClicksAbsorbed] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const MAX_ABSORBED_CLICKS = 3;

  useEffect(() => {
    const t = setTimeout(() => {
      if (!dismissed) {
        setDismissed(true);
        onDismiss();
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [onDismiss, dismissed]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = clicksAbsorbed + 1;
    setClicksAbsorbed(next);
    if (next >= MAX_ABSORBED_CLICKS) {
      setDismissed(true);
      onDismiss();
    }
  }, [clicksAbsorbed, onDismiss]);

  if (dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleClick}
      className="absolute inset-0 z-20 cursor-pointer"
      style={{ background: 'transparent' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-emerald-500/20 pointer-events-none"
      >
        <Shield size={12} className="text-emerald-400" />
        <span className="text-emerald-300 text-[10px] font-medium">
          Ad Shield · {MAX_ABSORBED_CLICKS - clicksAbsorbed} click{MAX_ABSORBED_CLICKS - clicksAbsorbed !== 1 ? 's' : ''} remaining
        </span>
      </motion.div>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
          className="px-5 py-3 rounded-2xl bg-black/70 backdrop-blur-xl border border-white/10"
        >
          <p className="text-white/60 text-sm font-medium text-center">Tap {MAX_ABSORBED_CLICKS - clicksAbsorbed}× to skip ads</p>
          <p className="text-white/30 text-[10px] text-center mt-1">Absorbing ad redirects…</p>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ─── Iframe Provider Player (fallback for TMDB browsing) ─────────────
function IframePlayer({
  providers,
  activeProviderId,
  onProviderChange,
  onProviderError,
  tmdbId,
  mediaType,
  season,
  episode,
}: Required<Pick<StreamPlayerProps, 'providers' | 'activeProviderId' | 'onProviderChange' | 'onProviderError'>> & Pick<StreamPlayerProps, 'tmdbId' | 'mediaType' | 'season' | 'episode'>) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [adBlockActive, setAdBlockActive] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const activeProvider = providers.find(p => p.id === activeProviderId);
  const activeUrl = activeProvider?.url || '';

  useEffect(() => {
    setTimeout(() => {
      setIsLoading(true);
      setHasError(false);
      setAdBlockActive(true);
    }, 0);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsLoading(false), 8000);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [activeProviderId]);

  useEffect(() => {
    const originalOpen = window.open;
    window.open = function (...args: Parameters<typeof window.open>) {
      console.log('[ATMOS AdBlock] Blocked popup:', args[0]);
      return null;
    };
    return () => { window.open = originalOpen; };
  }, []);

  const reportHealth = (success: boolean) => {
    if (!tmdbId || !activeProviderId) return;
    fetch(`${SUBS_URL}/provider-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdb_id: tmdbId, type: mediaType || 'movie', season: season || 0, episode: episode || 0, provider_id: activeProviderId, success }),
    }).catch(() => {});
  };

  const handleIframeError = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsLoading(false);
    setHasError(true);
    reportHealth(false);
    onProviderError(activeProviderId);
    const idx = providers.findIndex(p => p.id === activeProviderId);
    if (idx < providers.length - 1) {
      setTimeout(() => onProviderChange(providers[idx + 1].id), 1500);
    }
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    setHasError(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setTimeout(() => {
      if (!hasError) reportHealth(true);
    }, 5000);
  };

  if (!activeUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="text-center">
          <AlertTriangle size={48} className="text-red-400 mx-auto mb-4" />
          <p className="text-white/70 text-lg font-medium">No servers available</p>
          <p className="text-white/30 text-sm mt-1">All providers are currently down</p>
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
          <ShieldCheck size={11} className="text-emerald-400/60" />
          <span className="text-emerald-300/40 text-[9px] font-medium">Protected</span>
        </motion.div>
      )}

      <AnimatePresence>
        {isLoading && !adBlockActive && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-2 border-white/5" />
                <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
                <div className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
              </div>
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
              <AlertTriangle size={40} className="text-amber-400 mx-auto mb-3" />
              <p className="text-white/70 text-sm font-medium">Server failed to load</p>
              <p className="text-white/30 text-xs mt-1 mb-4">Trying next server...</p>
              <button onClick={() => { setHasError(false); setIsLoading(true); setAdBlockActive(true); if (iframeRef.current) iframeRef.current.src = activeUrl; }}
                className="flex items-center gap-2 px-4 py-2 mx-auto rounded-full bg-white/10 hover:bg-white/15 text-white text-sm transition-all border border-white/10">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// ─── Unified StreamPlayer ────────────────────────────────────────────
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
}: StreamPlayerProps) {
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [hlsFailed, setHlsFailed] = useState(false);
  const [hlsLoading, setHlsLoading] = useState(!!tmdbId && !fileId);
  const [extractionLog, setExtractionLog] = useState<string>("Locating Stream...");

  // Attempt Client-Side HLS extraction on mount for TMDB titles
  useEffect(() => {
    if (fileId || !tmdbId || hlsFailed) return;

    let isMounted = true;

    async function extract() {
      setHlsLoading(true);
      setExtractionLog("Fetching metadata...");
      try {
        const titleRes = await fetch(`/api/title?id=${tmdbId}&type=${mediaType || 'movie'}`);
        const titleData = await titleRes.json();

        const title = titleData?.detail?.title || titleData?.detail?.name;
        const releaseYearStr = titleData?.detail?.release_date || titleData?.detail?.first_air_date;
        const releaseYear = releaseYearStr ? parseInt(releaseYearStr.substring(0, 4)) : new Date().getFullYear();

        if (!title) throw new Error("Metadata missing");

        setExtractionLog("Cracking stream providers...");

        const mediaDetails: MediaDetails = {
          type: mediaType || 'movie',
          title,
          releaseYear,
          tmdbId: tmdbId as string,
          season,
          episode
        };

        const streamUrl = await extractStreamClient(mediaDetails);

        if (isMounted) {
          if (streamUrl) {
            setExtractionLog("Stream found!");
            setHlsUrl(streamUrl);
          } else {
            setHlsFailed(true);
          }
        }
      } catch (error) {
        if (isMounted) {
          console.error("Extraction error:", error);
          setHlsFailed(true);
        }
      } finally {
        if (isMounted) {
          setHlsLoading(false);
        }
      }
    }

    extract();

    return () => { isMounted = false; };
  }, [tmdbId, mediaType, season, episode, fileId, hlsFailed]);

  // Tier 1: GDrive
  if (fileId) {
    const streamUrl = `${CONTROL_URL}/api/stream/${fileId}`;
    return <NativeVideoPlayer src={streamUrl} title={fileName} />;
  }

  // Tier 2: HLS extraction result
  if (hlsUrl && !hlsFailed) {
    return <NativeVideoPlayer src={hlsUrl} isHls={true} onFatalError={() => { setHlsUrl(null); setHlsFailed(true); }} />;
  }

  // Loading state while extraction is in progress
  if (hlsLoading) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-5">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-white/5" />
            <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
            <div className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
          </div>
          <motion.p 
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            transition={{ repeat: Infinity, duration: 1, repeatType: "reverse" }}
            className="text-white/60 text-sm font-medium tracking-wide"
          >
            {extractionLog}
          </motion.p>
        </div>
      </div>
    );
  }

  // Tier 3: Sandboxed iframe fallback
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
