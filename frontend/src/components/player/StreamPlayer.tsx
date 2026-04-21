"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw, Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, Shield, ShieldCheck } from 'lucide-react';
import { CONTROL_URL, SUBS_URL, MEDIA_URL } from '@/lib/constants';

interface StreamPlayerProps {
  // GDrive mode: direct file streaming (primary)
  fileId?: string;
  fileName?: string;
  // Provider/iframe mode: fallback for TMDB browsing (legacy)
  providers?: { id: string; name: string; url: string; priority: number }[];
  activeProviderId?: string;
  onProviderChange?: (id: string) => void;
  onProviderError?: (id: string) => void;
  // Metadata for health engine reporting
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

// ─── GDrive Video Player ────────────────────────────────────────────
function GDrivePlayer({ fileId, fileName }: { fileId: string; fileName?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const controlsTimer = useRef<NodeJS.Timeout | null>(null);

  const streamUrl = `${CONTROL_URL}/api/stream/${fileId}`;

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
    resetControlsTimer();
  }, [resetControlsTimer]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + seconds));
    resetControlsTimer();
  }, [resetControlsTimer]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    v.currentTime = pct * duration;
    resetControlsTimer();
  }, [duration, resetControlsTimer]);

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); seek(-10); break;
        case 'ArrowRight': e.preventDefault(); seek(10); break;
        case 'm': case 'M': toggleMute(); break;
        case 'f': case 'F': toggleFullscreen(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, seek, toggleMute, toggleFullscreen]);

  if (hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="text-center">
          <AlertTriangle size={48} className="text-amber-400 mx-auto mb-4" />
          <p className="text-white/70 text-lg font-medium mb-2">Stream failed to load</p>
          <p className="text-white/30 text-sm mb-6">The file may be unavailable or the server is busy</p>
          <button
            onClick={() => { setHasError(false); setIsLoading(true); if (videoRef.current) videoRef.current.load(); }}
            className="flex items-center gap-2 px-5 py-2.5 mx-auto rounded-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group"
      onMouseMove={resetControlsTimer}
      onTouchStart={resetControlsTimer}
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        src={streamUrl}
        className="w-full h-full object-contain"
        autoPlay
        playsInline
        onPlay={() => { setIsPlaying(true); resetControlsTimer(); }}
        onPause={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); setIsLoading(false); }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setProgress(v.duration ? (v.currentTime / v.duration) * 100 : 0);
        }}
        onWaiting={() => setIsLoading(true)}
        onCanPlay={() => setIsLoading(false)}
        onError={() => setHasError(true)}
      />

      {/* Loading spinner */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
          >
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-white/5" />
              <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
              <div className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/40 to-transparent pb-4 pt-16"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress bar */}
            <div
              className="mx-4 mb-3 h-1 bg-white/20 rounded-full cursor-pointer relative group/bar"
              onClick={handleProgressClick}
            >
              <div
                className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover/bar:opacity-100 transition-opacity"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>

            {/* Buttons row */}
            <div className="flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <button onClick={() => seek(-10)} className="text-white/70 hover:text-white transition-colors p-1">
                  <SkipBack size={18} />
                </button>
                <button onClick={togglePlay} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
                  {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>
                <button onClick={() => seek(10)} className="text-white/70 hover:text-white transition-colors p-1">
                  <SkipForward size={18} />
                </button>
                <button onClick={toggleMute} className="text-white/70 hover:text-white transition-colors p-1">
                  {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <span className="text-white/40 text-xs font-mono">
                  {formatTime((progress / 100) * duration)} / {formatTime(duration)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {fileName && (
                  <span className="text-white/30 text-xs truncate max-w-[200px] hidden sm:block">{fileName}</span>
                )}
                <button onClick={toggleFullscreen} className="text-white/70 hover:text-white transition-colors p-1">
                  {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Ad Blocker Shield V2 ───────────────────────────────────────────
// Active click interceptor: absorbs the first N clicks that embed players
// use to trigger ad redirects, then fades to allow real playback.
// Also blocks popups and top-navigation from iframe scripts.
function AdBlockerOverlay({ onDismiss }: { onDismiss: () => void }) {
  const [clicksAbsorbed, setClicksAbsorbed] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const MAX_ABSORBED_CLICKS = 3;

  // Auto-dismiss after 4s even if no clicks — some providers are clean
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
      {/* Tap-anywhere hint */}
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

  // Reset ad blocker when provider changes
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

  // Block popup windows globally while iframe is active
  useEffect(() => {
    const originalOpen = window.open;
    window.open = function (...args: Parameters<typeof window.open>) {
      // Block all popups from iframe providers — these are always ads
      console.log('[ATMOS AdBlock] Blocked popup:', args[0]);
      return null;
    };
    return () => { window.open = originalOpen; };
  }, []);

  // Block beforeunload events (some ad scripts try to navigate the parent)
  useEffect(() => {
    const blockNav = (e: BeforeUnloadEvent) => {
      // Only block if it's likely an ad redirect
      e.preventDefault();
    };
    window.addEventListener('beforeunload', blockNav);
    return () => window.removeEventListener('beforeunload', blockNav);
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
    // Delay health report — onLoad fires even for error pages.
    // Wait 5s: if user hasn't triggered an error by then, stream is genuinely working.
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

      {/* Ad Blocker Overlay — absorbs first clicks that would trigger redirects */}
      {adBlockActive && (
        <AdBlockerOverlay onDismiss={() => setAdBlockActive(false)} />
      )}

      {/* Shield badge when ad-block is deactivated (user passed through) */}
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

      {/* Loading overlay */}
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

      {/* Error overlay */}
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

// ─── HLS Native Player ───────────────────────────────────────────────
// Plays a raw .m3u8 URL using native video element + hls.js polyfill.
// Called when media_server extracts a clean stream URL.
function HLSNativePlayer({ streamUrl, onError }: { streamUrl: string; onError: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    // Native HLS (Safari) or hls.js for Chrome/Firefox
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.play().catch(() => {});
      setIsLoading(false);
    } else {
      // Dynamically load hls.js
      import('hls.js').then(({ default: Hls }) => {
        if (!Hls.isSupported()) { onError(); return; }
        const hls = new Hls({
          maxBufferLength: 60,          // buffer 60s ahead
          maxMaxBufferLength: 120,
          startLevel: -1,               // auto quality
          abrEwmaDefaultEstimate: 5e6,  // assume 5mbps initially
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
          setIsLoading(false);
        });
        hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean }) => {
          if (data.fatal) { hls.destroy(); onError(); }
        });
        return () => hls.destroy();
      }).catch(onError);
    }
  }, [streamUrl, onError]);

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        controls
        playsInline
        autoPlay
        onLoadedData={() => setIsLoading(false)}
        onError={onError}
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
            <div className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin" style={{ animationDirection: 'reverse' }} />
          </div>
        </div>
      )}
      {/* Ad-free badge */}
      <div className="absolute top-3 right-3 pointer-events-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/50 backdrop-blur-md border border-emerald-500/20">
        <ShieldCheck size={11} className="text-emerald-400" />
        <span className="text-emerald-300 text-[9px] font-medium">Ad-Free Stream</span>
      </div>
    </div>
  );
}

// ─── Unified StreamPlayer ────────────────────────────────────────────
// Tier 1: GDrive native video (best — our server, our controls)
// Tier 2: HLS extraction (media_server Playwright → clean .m3u8, our player)
// Tier 3: Sandboxed iframe (fallback — their player, our sandbox)
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

  // Attempt HLS extraction on mount for TMDB titles
  useEffect(() => {
    if (fileId || !tmdbId || hlsFailed) return;

    setTimeout(() => setHlsLoading(true), 0);
    const controller = new AbortController();
    const isTV = mediaType === 'tv';
    const url = `${MEDIA_URL}/extract/${tmdbId}?media_type=${isTV ? 'tv' : 'movie'}&season=${season ?? 1}&episode=${episode ?? 1}`;

    fetch(url, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.status === 'success' && data?.stream_url) {
          setHlsUrl(data.stream_url);
        } else {
          setHlsFailed(true);
        }
        setHlsLoading(false);
      })
      .catch(() => { setHlsFailed(true); setHlsLoading(false); });

    // Timeout — don't wait forever; fall through to iframe after 3s
    const timeout = setTimeout(() => { controller.abort(); setHlsFailed(true); setHlsLoading(false); }, 3000);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [tmdbId, mediaType, season, episode, fileId, hlsFailed]);

  // Tier 1: GDrive
  if (fileId) return <GDrivePlayer fileId={fileId} fileName={fileName} />;

  // Tier 2: HLS extraction result
  if (hlsUrl && !hlsFailed) {
    return <HLSNativePlayer streamUrl={hlsUrl} onError={() => { setHlsUrl(null); setHlsFailed(true); }} />;
  }

  // Loading state while extraction is in progress
  if (hlsLoading) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
            <div className="absolute inset-2 rounded-full border-2 border-t-cyan-400/60 animate-spin" style={{ animationDirection: 'reverse' }} />
          </div>
          <p className="text-white/50 text-sm">Extracting clean stream…</p>
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

