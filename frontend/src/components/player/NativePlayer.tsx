"use client";

// ═══════════════════════════════════════════════════════════════════════
// ATMOS V2.0 — Native Video Player (hls.js + Custom Controls)
// ═══════════════════════════════════════════════════════════════════════
// Plays raw m3u8/mp4 streams with a premium dark UI.
// Features: download button, precise watch tracking, quality selector,
// and full keyboard controls.

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Download, Loader2, AlertTriangle, SkipForward,
  Settings, ChevronRight,
} from 'lucide-react';
import type { ExtractedStream } from '@/lib/extractor';
import { getDownloadUrl } from '@/lib/extractor';

interface NativePlayerProps {
  stream: ExtractedStream;
  title?: string;
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  season?: number;
  episode?: number;
  onNextEpisode?: () => void;
  /** Called when native player fails — parent should switch to iframe */
  onFallback?: () => void;
}

export default function NativePlayer({
  stream,
  title,
  tmdbId,
  mediaType,
  season,
  episode,
  onNextEpisode,
  onFallback,
}: NativePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showQuality, setShowQuality] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState(stream.quality || 'auto');
  const [isDownloading, setIsDownloading] = useState(false);

  // ── Initialize HLS or direct source ────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;

    const initPlayer = async () => {
      try {
        if (stream.type === 'hls') {
          // Dynamic import to avoid SSR issues
          const Hls = (await import('hls.js')).default;

          if (Hls.isSupported()) {
            const hls = new Hls({
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
              startLevel: -1, // Auto quality
              enableWorker: true,
              lowLatencyMode: false,
              xhrSetup: (xhr: XMLHttpRequest) => {
                // Apply custom headers if the stream requires them
                if (stream.headers) {
                  Object.entries(stream.headers).forEach(([key, val]) => {
                    try { xhr.setRequestHeader(key, val); } catch { /* ignore */ }
                  });
                }
              },
            });

            hls.loadSource(stream.url);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!destroyed) {
                setIsLoading(false);
                video.play().catch(() => { /* autoplay blocked */ });
              }
            });

            hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; type: string; details: string }) => {
              if (data.fatal) {
                console.error('[NativePlayer] Fatal HLS error:', data.type, data.details);
                if (data.type === 'networkError') {
                  // Try to recover once
                  hls.startLoad();
                } else {
                  setError(`Playback error: ${data.details}`);
                  onFallback?.();
                }
              }
            });

            hlsRef.current = hls;
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS
            video.src = stream.url;
            video.addEventListener('loadedmetadata', () => {
              if (!destroyed) {
                setIsLoading(false);
                video.play().catch(() => {});
              }
            });
          } else {
            setError('Your browser does not support HLS playback');
            onFallback?.();
          }
        } else {
          // Direct MP4
          video.src = stream.url;
          video.addEventListener('loadedmetadata', () => {
            if (!destroyed) {
              setIsLoading(false);
              video.play().catch(() => {});
            }
          });
        }

        // Error handler
        video.addEventListener('error', () => {
          if (!destroyed) {
            const mediaError = video.error;
            const errorMsg = mediaError
              ? `Video error: ${mediaError.message || `code ${mediaError.code}`}`
              : 'Unknown playback error';
            console.error('[NativePlayer]', errorMsg);
            setError(errorMsg);
            onFallback?.();
          }
        });

        // Stall detection — if video stalls for 10s, offer fallback
        let stallTimer: NodeJS.Timeout;
        video.addEventListener('waiting', () => {
          stallTimer = setTimeout(() => {
            if (!destroyed && video.readyState < 3) {
              setError('Stream is buffering too slowly');
              onFallback?.();
            }
          }, 15_000);
        });
        video.addEventListener('playing', () => clearTimeout(stallTimer));
      } catch (err) {
        console.error('[NativePlayer] Init error:', err);
        setError('Failed to initialize player');
        onFallback?.();
      }
    };

    initPlayer();

    return () => {
      destroyed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [stream, onFallback]);

  // ── Video event listeners ──────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      setDuration(video.duration || 0);

      // Broadcast progress for watch history
      if (video.duration > 0 && tmdbId) {
        const progressPct = Math.round((video.currentTime / video.duration) * 100);
        window.dispatchEvent(new CustomEvent('atmos:progress', {
          detail: {
            tmdbId, mediaType, season, episode,
            progress: progressPct,
            currentTime: video.currentTime,
            duration: video.duration,
          }
        }));
      }
    };

    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      onNextEpisode?.();
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('progress', onProgress);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [tmdbId, mediaType, season, episode, onNextEpisode]);

  // ── Auto-hide controls ─────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3500);
  }, [isPlaying]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [resetControlsTimer]);

  // ── Keyboard controls ──────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          video.paused ? video.play() : video.pause();
          resetControlsTimer();
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
          resetControlsTimer();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          resetControlsTimer();
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          setVolume(video.volume);
          resetControlsTimer();
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          setVolume(video.volume);
          resetControlsTimer();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          video.muted = !video.muted;
          setIsMuted(video.muted);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetControlsTimer]);

  // ── Player controls ────────────────────────────────────────────────
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.paused ? video.play() : video.pause();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      container.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const bar = progressRef.current;
    if (!video || !bar) return;

    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * video.duration;
  };

  const handleDownload = async () => {
    const dl = getDownloadUrl(stream);
    if (!dl) return;

    if (dl.type === 'mp4') {
      // Direct download
      const a = document.createElement('a');
      a.href = dl.url;
      a.download = `${title || 'video'}.mp4`;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // HLS — open in new tab (user can use browser extension or external tool)
      setIsDownloading(true);
      try {
        window.open(dl.url, '_blank');
      } finally {
        setTimeout(() => setIsDownloading(false), 2000);
      }
    }
  };

  const handleQualityChange = (quality: string) => {
    if (stream.type === 'file' && stream.qualities?.[quality]) {
      const video = videoRef.current;
      if (video) {
        const currentPos = video.currentTime;
        video.src = stream.qualities[quality];
        video.currentTime = currentPos;
        video.play().catch(() => {});
      }
    }
    setSelectedQuality(quality);
    setShowQuality(false);
  };

  // ── Formatters ─────────────────────────────────────────────────────
  const formatTime = (t: number) => {
    if (!isFinite(t)) return '0:00';
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      : `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Error state ────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="text-center">
          <AlertTriangle size={48} className="text-amber-400 mx-auto mb-4" />
          <p className="text-white/70 text-lg font-medium">Native Player Error</p>
          <p className="text-white/40 text-sm mt-1 max-w-sm mx-auto">{error}</p>
          <p className="text-white/30 text-xs mt-3">Switching to fallback player...</p>
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
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        onClick={togglePlay}
      />

      {/* Loading spinner */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/80 z-20"
          >
            <div className="flex flex-col items-center gap-4">
              <Loader2 size={40} className="text-violet-400 animate-spin" />
              <p className="text-white/60 text-sm">Loading native stream...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Center play/pause button (click feedback) */}
      <AnimatePresence>
        {!isLoading && showControls && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center z-10"
          >
            <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-xl flex items-center justify-center hover:bg-white/20 transition-all">
              {isPlaying ? (
                <Pause size={28} className="text-white" />
              ) : (
                <Play size={28} className="text-white ml-1" />
              )}
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Bottom controls */}
      <AnimatePresence>
        {showControls && !isLoading && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-16 pb-4 px-4"
          >
            {/* Progress bar */}
            <div
              ref={progressRef}
              className="relative h-1.5 bg-white/10 rounded-full cursor-pointer mb-3 group/bar hover:h-2.5 transition-all"
              onClick={handleSeek}
            >
              {/* Buffered */}
              <div
                className="absolute h-full bg-white/20 rounded-full"
                style={{ width: duration > 0 ? `${(buffered / duration) * 100}%` : '0%' }}
              />
              {/* Progress */}
              <div
                className="absolute h-full bg-violet-500 rounded-full"
                style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg opacity-0 group-hover/bar:opacity-100 transition-opacity"
                style={{ left: duration > 0 ? `calc(${(currentTime / duration) * 100}% - 7px)` : '0' }}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Play/Pause */}
                <button onClick={togglePlay} className="text-white hover:text-violet-300 transition-colors">
                  {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>

                {/* Next Episode */}
                {onNextEpisode && (
                  <button onClick={onNextEpisode} className="text-white/60 hover:text-white transition-colors">
                    <SkipForward size={18} />
                  </button>
                )}

                {/* Volume */}
                <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors">
                  {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>

                {/* Time */}
                <span className="text-white/50 text-xs font-mono">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Quality selector */}
                {stream.type === 'file' && stream.qualities && Object.keys(stream.qualities).length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowQuality(!showQuality)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-all"
                    >
                      <Settings size={12} />
                      {selectedQuality}
                    </button>
                    <AnimatePresence>
                      {showQuality && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 5 }}
                          className="absolute bottom-full right-0 mb-2 bg-zinc-900/95 border border-white/10 rounded-xl overflow-hidden min-w-[120px] backdrop-blur-xl"
                        >
                          {Object.keys(stream.qualities).map(q => (
                            <button
                              key={q}
                              onClick={() => handleQualityChange(q)}
                              className={`w-full text-left px-4 py-2 text-xs transition-all flex items-center justify-between ${
                                selectedQuality === q
                                  ? 'text-violet-300 bg-violet-500/10'
                                  : 'text-white/60 hover:text-white hover:bg-white/5'
                              }`}
                            >
                              {q === '4k' ? '4K' : q === 'unknown' ? 'Auto' : `${q}p`}
                              {selectedQuality === q && <ChevronRight size={10} />}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Download */}
                <button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-violet-300 hover:text-white bg-violet-600/20 hover:bg-violet-600/30 rounded-lg transition-all disabled:opacity-40"
                >
                  {isDownloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  <span className="hidden sm:inline">Download</span>
                </button>

                {/* Fullscreen */}
                <button onClick={toggleFullscreen} className="text-white/60 hover:text-white transition-colors">
                  {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
