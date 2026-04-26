"use client";

// ═══════════════════════════════════════════════════════════════════════
// ATMOS V9.0 — Native Video Player (hls.js + Custom Controls)
// ═══════════════════════════════════════════════════════════════════════
// Premium dark UI with: volume memory, playback speed, PiP, buffer
// spinner, mobile double-tap seek, landscape lock, error retry,
// download, quality selector, keyboard controls, watch tracking.

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Volume2, Volume1, VolumeX, Maximize, Minimize,
  Download, Loader2, AlertTriangle, SkipForward, RefreshCw,
  Settings, ChevronRight, PictureInPicture2, Gauge,
} from 'lucide-react';
import type { ExtractedStream } from '@/lib/extractor';
import { getDownloadUrl } from '@/lib/extractor';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
  const [volume, setVolume] = useState(() => {
    if (typeof window !== 'undefined') {
      return parseFloat(localStorage.getItem('atmos-volume') ?? '1');
    }
    return 1;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(() => {
    if (typeof window !== 'undefined') {
      return parseFloat(localStorage.getItem('atmos-speed') ?? '1');
    }
    return 1;
  });
  const [selectedQuality, setSelectedQuality] = useState(stream.quality || 'auto');
  const [isDownloading, setIsDownloading] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Mobile double-tap state
  const [doubleTapSide, setDoubleTapSide] = useState<'left' | 'right' | null>(null);
  const tapTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tapCountRef = useRef(0);

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
                video.volume = parseFloat(localStorage.getItem('atmos-volume') ?? '1');
                video.playbackRate = parseFloat(localStorage.getItem('atmos-speed') ?? '1');
                video.play().catch(() => { /* autoplay blocked */ });
              }
            });

            hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean; type: string; details: string }) => {
              if (data.fatal) {
                console.error('[NativePlayer] Fatal HLS error:', data.type, data.details);
                if (data.type === 'networkError') {
                  hls.startLoad();
                } else if (data.type === 'mediaError') {
                  hls.recoverMediaError();
                } else {
                  setError(`Playback error: ${data.details}`);
                  setCanRetry(true);
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

        // Buffer spinner + stall detection
        let stallTimer: NodeJS.Timeout;
        video.addEventListener('waiting', () => {
          if (!destroyed) setIsBuffering(true);
          stallTimer = setTimeout(() => {
            if (!destroyed && video.readyState < 3) {
              setError('Stream is buffering too slowly');
              setCanRetry(true);
            }
          }, 15_000);
        });
        video.addEventListener('playing', () => {
          clearTimeout(stallTimer);
          if (!destroyed) setIsBuffering(false);
        });
        video.addEventListener('canplay', () => {
          if (!destroyed) setIsBuffering(false);
        });
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
    if (!video.muted) {
      video.volume = volume || 1;
    }
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
      try { screen.orientation.unlock(); } catch {}
    } else {
      container.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
      try { (screen.orientation as any).lock('landscape').catch(() => {}); } catch {}
    }
  };

  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {}
  };

  const changeSpeed = (speed: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    setPlaybackSpeed(speed);
    localStorage.setItem('atmos-speed', String(speed));
    setShowSpeedMenu(false);
  };

  const handleVolumeChange = (newVol: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
    video.muted = newVol === 0;
    localStorage.setItem('atmos-volume', String(newVol));
  };

  const handleRetry = () => {
    setError(null);
    setCanRetry(false);
    const hls = hlsRef.current;
    if (hls) {
      hls.startLoad();
      hls.recoverMediaError();
    }
    videoRef.current?.play().catch(() => {});
  };

  // Mobile double-tap seek
  const handleTouchTap = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || !videoRef.current) return;
    const rect = container.getBoundingClientRect();
    const x = e.changedTouches[0].clientX - rect.left;
    const side = x < rect.width / 2 ? 'left' : 'right';

    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

    tapTimerRef.current = setTimeout(() => {
      if (tapCountRef.current === 1) {
        // Single tap — toggle controls
        setShowControls(prev => !prev);
      }
      tapCountRef.current = 0;
    }, 250);

    if (tapCountRef.current === 2) {
      // Double tap — seek ±10s
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapCountRef.current = 0;
      const video = videoRef.current;
      if (side === 'right') {
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
      } else {
        video.currentTime = Math.max(0, video.currentTime - 10);
      }
      setDoubleTapSide(side);
      setTimeout(() => setDoubleTapSide(null), 600);
      resetControlsTimer();
    }
  }, [resetControlsTimer]);

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
          <p className="text-white/70 text-lg font-medium">Playback Error</p>
          <p className="text-white/40 text-sm mt-1 max-w-sm mx-auto">{error}</p>
          <div className="flex gap-3 justify-center mt-5">
            {canRetry && (
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-full transition-all"
              >
                <RefreshCw size={14} /> Retry
              </button>
            )}
            <button
              onClick={() => onFallback?.()}
              className="flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/15 text-white/70 text-sm rounded-full transition-all"
            >
              Switch Player
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group"
      onMouseMove={resetControlsTimer}
      onTouchEnd={handleTouchTap}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        onClick={togglePlay}
      />

      {/* Double-tap seek ripple */}
      <AnimatePresence>
        {doubleTapSide && (
          <motion.div
            initial={{ opacity: 0.7, scale: 0.5 }}
            animate={{ opacity: 0, scale: 1.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className={`absolute top-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-white/20 pointer-events-none z-40 flex items-center justify-center ${
              doubleTapSide === 'left' ? 'left-[15%]' : 'right-[15%]'
            }`}
          >
            <span className="text-white font-bold text-sm">
              {doubleTapSide === 'left' ? '−10s' : '+10s'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buffering spinner */}
      <AnimatePresence>
        {isBuffering && !isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center z-15 pointer-events-none"
          >
            <Loader2 size={40} className="text-white/70 animate-spin" />
          </motion.div>
        )}
      </AnimatePresence>

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

                {/* Volume with slider */}
                <div className="relative flex items-center gap-1"
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  onMouseLeave={() => setShowVolumeSlider(false)}
                >
                  <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors">
                    {isMuted || volume === 0 ? <VolumeX size={18} /> : volume < 0.5 ? <Volume1 size={18} /> : <Volume2 size={18} />}
                  </button>
                  {showVolumeSlider && (
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                      className="w-20 h-1 accent-violet-500 cursor-pointer"
                    />
                  )}
                </div>

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

                {/* Playback Speed */}
                <div className="relative">
                  <button
                    onClick={() => { setShowSpeedMenu(!showSpeedMenu); setShowQuality(false); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-all"
                  >
                    <Gauge size={12} />
                    {playbackSpeed === 1 ? '1×' : `${playbackSpeed}×`}
                  </button>
                  <AnimatePresence>
                    {showSpeedMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute bottom-full right-0 mb-2 bg-zinc-900/95 border border-white/10 rounded-xl overflow-hidden min-w-[100px] backdrop-blur-xl"
                      >
                        {SPEED_OPTIONS.map(s => (
                          <button
                            key={s}
                            onClick={() => changeSpeed(s)}
                            className={`w-full text-left px-4 py-2 text-xs transition-all flex items-center justify-between ${
                              playbackSpeed === s
                                ? 'text-violet-300 bg-violet-500/10'
                                : 'text-white/60 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            {s === 1 ? 'Normal' : `${s}×`}
                            {playbackSpeed === s && <ChevronRight size={10} />}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Picture-in-Picture */}
                {'pictureInPictureEnabled' in document && (
                  <button onClick={togglePiP} className="text-white/60 hover:text-white transition-colors" title="Picture in Picture">
                    <PictureInPicture2 size={18} />
                  </button>
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
